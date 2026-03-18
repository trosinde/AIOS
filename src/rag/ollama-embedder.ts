import type { EmbeddingProvider } from "./types.js";

/**
 * OllamaEmbedder – calls Ollama's /api/embeddings endpoint.
 * Reuses endpoint + apiKey from existing Ollama provider config.
 */
export class OllamaEmbedder implements EmbeddingProvider {
  readonly modelId: string;
  private endpoint: string;
  private apiKey?: string;
  private _dimensions: number = 0;
  private probed = false;

  constructor(
    model: string = "all-minilm",
    endpoint: string = "http://localhost:11434",
    apiKey?: string,
  ) {
    this.modelId = model;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.endpoint}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({ model: this.modelId, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { embedding?: number[]; error?: string };
    if (data.error) throw new Error(`Ollama embeddings: ${data.error}`);
    if (!data.embedding) throw new Error("Ollama: keine Embedding-Antwort erhalten");

    const embedding = new Float32Array(data.embedding);
    if (!this.probed) {
      this._dimensions = embedding.length;
      this.probed = true;
    }
    return embedding;
  }

  async embedBatch(texts: string[], batchSize: number = 32): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      // Ollama doesn't have a batch endpoint — sequential calls
      for (const text of batch) {
        results.push(await this.embed(text));
      }
    }
    return results;
  }
}
