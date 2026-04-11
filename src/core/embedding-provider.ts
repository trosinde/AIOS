/**
 * Embedding Provider abstraction for the Knowledge Bus.
 *
 * The KB stores semantic vectors next to each message and uses them
 * for `semanticSearch` and `checkDuplicate` (near-dup detection). The
 * concrete provider that turns text into vectors lives behind this
 * interface so the KB never imports a specific runtime.
 *
 * Default implementation talks HTTP to a local Ollama instance using
 * the `nomic-embed-text` model (768-dim). Configurable via aios.yaml.
 */

export interface EmbeddingProvider {
  /** The fixed output dimension. KB uses this to validate the LanceDB schema. */
  readonly dim: number;

  /** Embed a single text. Throws on transport / model errors. */
  embed(text: string): Promise<Float32Array>;

  /**
   * Embed many texts in one call. Implementations should batch when
   * the underlying API supports it; the default fallback maps over
   * single calls.
   */
  embedMany(texts: string[]): Promise<Float32Array[]>;

  /** Optional: short identifier for logs and the perf-baseline file. */
  readonly id: string;
}

export interface OllamaEmbeddingConfig {
  endpoint?: string; // default http://localhost:11434
  model?: string;    // default nomic-embed-text
  dim?: number;      // default 768
  timeoutMs?: number; // default 30000
}

/**
 * OllamaEmbeddingProvider — talks to /api/embeddings on a local Ollama.
 *
 * Single-text endpoint only. Ollama does not yet expose a batch
 * embedding endpoint, so embedMany falls back to parallel single calls
 * with bounded concurrency. Throughput on a typical local Ollama is
 * 30-60 embeddings/sec for nomic-embed-text on CPU.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;
  readonly id: string;
  private endpoint: string;
  private model: string;
  private timeoutMs: number;

  constructor(config: OllamaEmbeddingConfig = {}) {
    this.endpoint = config.endpoint ?? "http://localhost:11434";
    this.model = config.model ?? "nomic-embed-text";
    this.dim = config.dim ?? 768;
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.id = `ollama:${this.model}`;
  }

  async embed(text: string): Promise<Float32Array> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.endpoint}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`Ollama embedding failed: HTTP ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as { embedding?: number[]; error?: string };
      if (json.error) throw new Error(`Ollama embedding error: ${json.error}`);
      if (!Array.isArray(json.embedding)) {
        throw new Error("Ollama embedding response missing 'embedding' array");
      }
      if (json.embedding.length !== this.dim) {
        throw new Error(
          `Ollama embedding dim mismatch: expected ${this.dim}, got ${json.embedding.length}`,
        );
      }
      return Float32Array.from(json.embedding);
    } finally {
      clearTimeout(timer);
    }
  }

  async embedMany(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    // Bounded concurrency: 8 parallel requests is enough to saturate
    // local Ollama on most machines without thrashing the GIL/loop.
    const concurrency = 8;
    const results: Float32Array[] = new Array(texts.length);
    let nextIdx = 0;
    const workers = Array.from({ length: Math.min(concurrency, texts.length) }, async () => {
      while (true) {
        const i = nextIdx++;
        if (i >= texts.length) return;
        results[i] = await this.embed(texts[i]);
      }
    });
    await Promise.all(workers);
    return results;
  }
}

/**
 * StubEmbeddingProvider — deterministic, hash-based fake embeddings
 * for tests that don't have access to a real embedding model. NOT for
 * production. Same input → same vector, different inputs → different
 * vectors with high probability. Cosine similarity is meaningless,
 * but exact-equality and dim validation work fine.
 */
export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;
  readonly id = "stub";

  constructor(dim: number = 768) {
    this.dim = dim;
  }

  async embed(text: string): Promise<Float32Array> {
    const out = new Float32Array(this.dim);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
    }
    for (let i = 0; i < this.dim; i++) {
      h = Math.imul(h ^ (h >>> 13), 16777619) >>> 0;
      out[i] = ((h & 0xffff) / 65535) * 2 - 1;
    }
    // Normalize to unit length so cosine math behaves consistently.
    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += out[i] * out[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dim; i++) out[i] /= norm;
    return out;
  }

  async embedMany(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/**
 * Resolve an EmbeddingProvider from AiosConfig. Looks at
 * `config.knowledge?.embedding_provider` and instantiates accordingly.
 * Defaults to OllamaEmbeddingProvider with default settings if no
 * config is present. Tests can pass a stub directly.
 */
export interface KnowledgeEmbeddingConfig {
  type?: "ollama" | "stub";
  endpoint?: string;
  model?: string;
  dim?: number;
}

export function createEmbeddingProvider(
  config?: KnowledgeEmbeddingConfig,
): EmbeddingProvider {
  const type = config?.type ?? "ollama";
  if (type === "stub") {
    return new StubEmbeddingProvider(config?.dim ?? 768);
  }
  return new OllamaEmbeddingProvider({
    endpoint: config?.endpoint,
    model: config?.model,
    dim: config?.dim,
  });
}
