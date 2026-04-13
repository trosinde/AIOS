import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OllamaEmbeddingProvider,
  StubEmbeddingProvider,
  createEmbeddingProvider,
  createDefaultEmbeddingProvider,
} from "./embedding-provider.js";

describe("StubEmbeddingProvider", () => {
  it("uses default dim of 768", () => {
    const stub = new StubEmbeddingProvider();
    expect(stub.dim).toBe(768);
    expect(stub.id).toBe("stub");
  });

  it("accepts custom dimension", () => {
    const stub = new StubEmbeddingProvider(128);
    expect(stub.dim).toBe(128);
  });

  it("embed returns Float32Array of correct dimension", async () => {
    const stub = new StubEmbeddingProvider(64);
    const result = await stub.embed("hello");
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(64);
  });

  it("same input produces same embedding (deterministic)", async () => {
    const stub = new StubEmbeddingProvider(32);
    const a = await stub.embed("hello world");
    const b = await stub.embed("hello world");
    expect(a).toEqual(b);
  });

  it("different inputs produce different embeddings", async () => {
    const stub = new StubEmbeddingProvider(32);
    const a = await stub.embed("hello");
    const b = await stub.embed("world");
    expect(a).not.toEqual(b);
  });

  it("embeddings are unit-normalized", async () => {
    const stub = new StubEmbeddingProvider(128);
    const emb = await stub.embed("normalize me");
    let norm = 0;
    for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i];
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 4);
  });

  it("embedMany returns array of embeddings", async () => {
    const stub = new StubEmbeddingProvider(16);
    const results = await stub.embedMany(["a", "b", "c"]);
    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(r).toBeInstanceOf(Float32Array);
      expect(r.length).toBe(16);
    });
  });

  it("embedMany with empty array returns empty", async () => {
    const stub = new StubEmbeddingProvider();
    const results = await stub.embedMany([]);
    expect(results).toEqual([]);
  });
});

describe("OllamaEmbeddingProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses default config values", () => {
    const provider = new OllamaEmbeddingProvider();
    expect(provider.dim).toBe(768);
    expect(provider.id).toBe("ollama:nomic-embed-text");
  });

  it("accepts custom config", () => {
    const provider = new OllamaEmbeddingProvider({
      endpoint: "http://custom:1234",
      model: "bge-m3",
      dim: 1024,
      timeoutMs: 5000,
    });
    expect(provider.dim).toBe(1024);
    expect(provider.id).toBe("ollama:bge-m3");
  });

  it("embed sends correct request and returns Float32Array", async () => {
    const embedding = Array.from({ length: 768 }, (_, i) => i * 0.001);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding }),
    });

    const provider = new OllamaEmbeddingProvider();
    const result = await provider.embed("test text");

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(768);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embeddings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "nomic-embed-text", prompt: "test text" }),
      }),
    );
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const provider = new OllamaEmbeddingProvider();
    await expect(provider.embed("test")).rejects.toThrow(
      "Ollama embedding failed: HTTP 503 Service Unavailable",
    );
  });

  it("throws on API-level error in response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: "model 'x' not found" }),
    });

    const provider = new OllamaEmbeddingProvider();
    await expect(provider.embed("test")).rejects.toThrow(
      "Ollama embedding error: model 'x' not found",
    );
  });

  it("throws when embedding field is missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ something_else: true }),
    });

    const provider = new OllamaEmbeddingProvider();
    await expect(provider.embed("test")).rejects.toThrow(
      "Ollama embedding response missing 'embedding' array",
    );
  });

  it("throws on dimension mismatch", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
    });

    const provider = new OllamaEmbeddingProvider({ dim: 768 });
    await expect(provider.embed("test")).rejects.toThrow(
      "Ollama embedding dim mismatch: expected 768, got 3",
    );
  });

  it("embedMany returns empty array for empty input", async () => {
    const provider = new OllamaEmbeddingProvider();
    const results = await provider.embedMany([]);
    expect(results).toEqual([]);
  });

  it("embedMany processes texts with bounded concurrency", async () => {
    const embedding = Array.from({ length: 768 }, () => 0.1);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding }),
    });

    const provider = new OllamaEmbeddingProvider();
    const texts = Array.from({ length: 5 }, (_, i) => `text ${i}`);
    const results = await provider.embedMany(texts);

    expect(results).toHaveLength(5);
    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
    results.forEach((r) => {
      expect(r).toBeInstanceOf(Float32Array);
      expect(r.length).toBe(768);
    });
  });

  it("embed uses AbortController timeout", async () => {
    // Simulate a fetch that takes too long — AbortController should fire
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const provider = new OllamaEmbeddingProvider({ timeoutMs: 50 });
    await expect(provider.embed("test")).rejects.toThrow("aborted");
  });
});

describe("createEmbeddingProvider", () => {
  it("creates StubEmbeddingProvider for type 'stub'", () => {
    const provider = createEmbeddingProvider({ type: "stub", dim: 128 });
    expect(provider).toBeInstanceOf(StubEmbeddingProvider);
    expect(provider.dim).toBe(128);
  });

  it("creates StubEmbeddingProvider with default dim", () => {
    const provider = createEmbeddingProvider({ type: "stub" });
    expect(provider.dim).toBe(768);
  });

  it("creates OllamaEmbeddingProvider for type 'ollama'", () => {
    const provider = createEmbeddingProvider({ type: "ollama", model: "bge-m3" });
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.id).toBe("ollama:bge-m3");
  });

  it("defaults to OllamaEmbeddingProvider when no config", () => {
    const provider = createEmbeddingProvider();
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it("defaults to OllamaEmbeddingProvider when config is empty object", () => {
    const provider = createEmbeddingProvider({});
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });
});

describe("createDefaultEmbeddingProvider", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    envBackup.AIOS_EMBEDDING_PROVIDER = process.env.AIOS_EMBEDDING_PROVIDER;
    envBackup.AIOS_EMBEDDING_DIM = process.env.AIOS_EMBEDDING_DIM;
    envBackup.AIOS_OLLAMA_ENDPOINT = process.env.AIOS_OLLAMA_ENDPOINT;
    envBackup.AIOS_OLLAMA_MODEL = process.env.AIOS_OLLAMA_MODEL;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns StubEmbeddingProvider when AIOS_EMBEDDING_PROVIDER=stub", () => {
    process.env.AIOS_EMBEDDING_PROVIDER = "stub";
    const provider = createDefaultEmbeddingProvider();
    expect(provider).toBeInstanceOf(StubEmbeddingProvider);
  });

  it("returns StubEmbeddingProvider case-insensitive", () => {
    process.env.AIOS_EMBEDDING_PROVIDER = "STUB";
    const provider = createDefaultEmbeddingProvider();
    expect(provider).toBeInstanceOf(StubEmbeddingProvider);
  });

  it("returns OllamaEmbeddingProvider by default", () => {
    delete process.env.AIOS_EMBEDDING_PROVIDER;
    const provider = createDefaultEmbeddingProvider();
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it("respects AIOS_EMBEDDING_DIM for stub provider", () => {
    process.env.AIOS_EMBEDDING_PROVIDER = "stub";
    process.env.AIOS_EMBEDDING_DIM = "256";
    const provider = createDefaultEmbeddingProvider();
    expect(provider.dim).toBe(256);
  });

  it("passes env vars to OllamaEmbeddingProvider", () => {
    process.env.AIOS_EMBEDDING_PROVIDER = "ollama";
    process.env.AIOS_OLLAMA_ENDPOINT = "http://remote:9999";
    process.env.AIOS_OLLAMA_MODEL = "custom-model";
    process.env.AIOS_EMBEDDING_DIM = "512";
    const provider = createDefaultEmbeddingProvider();
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.id).toBe("ollama:custom-model");
    expect(provider.dim).toBe(512);
  });
});
