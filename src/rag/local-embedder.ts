import type { EmbeddingProvider } from "./types.js";

/**
 * LocalEmbedder – wraps @xenova/transformers for local embedding.
 * Default model: Xenova/all-MiniLM-L6-v2 (384 dimensions).
 * Lazy-loads the model on first embed() call.
 */
export class LocalEmbedder implements EmbeddingProvider {
  readonly modelId: string;
  private _dimensions: number = 0;
  private pipeline: any = null;
  private loading: Promise<void> | null = null;

  constructor(model: string = "Xenova/all-MiniLM-L6-v2") {
    this.modelId = model;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.pipeline) return;
    if (this.loading) { await this.loading; return; }

    this.loading = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      this.pipeline = await pipeline("feature-extraction", this.modelId);
      // Probe dimensions with a dummy embed
      const probe = await this.pipeline("test", { pooling: "mean", normalize: true });
      this._dimensions = probe.dims[1];
    })();

    await this.loading;
  }

  async embed(text: string): Promise<Float32Array> {
    await this.ensureLoaded();
    const output = await this.pipeline(text, { pooling: "mean", normalize: true });
    return new Float32Array(output.data);
  }

  async embedBatch(texts: string[], batchSize: number = 32): Promise<Float32Array[]> {
    await this.ensureLoaded();
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      // Process batch items sequentially — @xenova/transformers doesn't support true batching well
      for (const text of batch) {
        const output = await this.pipeline(text, { pooling: "mean", normalize: true });
        results.push(new Float32Array(output.data));
      }
    }

    return results;
  }
}
