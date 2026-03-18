import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VectorStore } from "./vector-store.js";
import { RAGService } from "./rag-service.js";
import type { EmbeddingProvider, CollectionConfig } from "./types.js";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/** Deterministic fake embedder for testing */
class FakeEmbedder implements EmbeddingProvider {
  readonly dimensions = 8;
  readonly modelId = "fake-model";

  async embed(text: string): Promise<Float32Array> {
    return this.textToEmbedding(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.textToEmbedding(t));
  }

  /** Deterministic embedding from text hash */
  private textToEmbedding(text: string): Float32Array {
    const arr = new Float32Array(this.dimensions);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    for (let i = 0; i < this.dimensions; i++) {
      arr[i] = Math.sin(hash + i * 7);
    }
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) norm += arr[i] * arr[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < this.dimensions; i++) arr[i] /= norm;
    return arr;
  }
}

describe("RAGService", () => {
  let store: VectorStore;
  let service: RAGService;
  const dbPath = join(tmpdir(), `aios-rag-test-${Date.now()}.db`);

  const testCollection: CollectionConfig = {
    name: "test-items",
    preprocessing: {
      maxChunkLength: 500,
      chunkStrategy: "truncate",
      cleaners: ["normalizeWhitespace"],
    },
    search: {
      minRelevance: 0,
      topK: 10,
    },
  };

  beforeEach(() => {
    store = new VectorStore(dbPath);
    const embedder = new FakeEmbedder();
    const collections = new Map([["test-items", testCollection]]);
    service = RAGService.fromComponents(store, embedder, collections);
  });

  afterEach(() => {
    service.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-wal"); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* ignore */ }
  });

  it("indexes and searches items", async () => {
    const count = await service.index("test-items", [
      { id: "item1", content: "Machine learning for image classification" },
      { id: "item2", content: "Database optimization and query tuning" },
      { id: "item3", content: "Deep learning neural network training" },
    ]);

    expect(count).toBe(3);

    const results = await service.search("test-items", "machine learning neural networks");
    expect(results.length).toBeGreaterThan(0);
    // At least some items should be returned (exact count depends on fake embedder similarity)
  });

  it("respects minRelevance filter", async () => {
    await service.index("test-items", [
      { id: "item1", content: "exact match query" },
      { id: "item2", content: "completely different topic about cooking" },
    ]);

    // With very high threshold, fewer results
    const results = await service.search("test-items", "exact match query", { minRelevance: 0.99 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("indexes with fields", async () => {
    const fieldCollection: CollectionConfig = {
      name: "field-test",
      preprocessing: {
        maxChunkLength: 500,
        chunkStrategy: "truncate",
        cleaners: ["normalizeWhitespace"],
        fields: ["title", "description"],
        fieldSeparator: " | ",
      },
      search: { minRelevance: 0, topK: 10 },
    };

    const collections = new Map([["field-test", fieldCollection]]);
    const embedder = new FakeEmbedder();
    const fieldService = RAGService.fromComponents(store, embedder, collections);

    const count = await fieldService.index("field-test", [
      { id: "wi-1", fields: { title: "Login Feature", description: "User authentication flow" } },
    ]);

    expect(count).toBe(1);
    const results = await fieldService.search("field-test", "authentication");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("Login Feature");
    expect(results[0].content).toContain("User authentication flow");
  });

  it("cross-collection compare", async () => {
    // Create two collections
    const col2: CollectionConfig = {
      name: "target",
      preprocessing: { maxChunkLength: 500, chunkStrategy: "truncate", cleaners: [] },
      search: { minRelevance: 0, topK: 10 },
    };
    const collections = new Map<string, CollectionConfig>([
      ["test-items", testCollection],
      ["target", col2],
    ]);
    const embedder = new FakeEmbedder();
    const svc = RAGService.fromComponents(store, embedder, collections);

    await svc.index("test-items", [
      { id: "src1", content: "API security requirements" },
    ]);
    await svc.index("target", [
      { id: "tgt1", content: "Security best practices for APIs" },
      { id: "tgt2", content: "Database backup procedures" },
    ]);

    const results = await svc.compare("test-items", ["src1"], "target", 10, -1);
    expect(results.length).toBeGreaterThan(0);
  });

  it("similarity returns a score", async () => {
    const score = await service.similarity("hello world", "hello world");
    expect(score).toBeCloseTo(1.0, 3);

    const score2 = await service.similarity("hello world", "completely different text");
    expect(score2).toBeLessThan(score);
  });

  it("throws on unknown collection", async () => {
    await expect(service.search("nonexistent", "query")).rejects.toThrow("nicht konfiguriert");
  });

  it("stats returns collection info", async () => {
    await service.index("test-items", [
      { id: "a", content: "alpha" },
      { id: "b", content: "beta" },
    ]);

    const stats = service.stats("test-items");
    expect(stats).toHaveLength(1);
    expect(stats[0].documentCount).toBe(2);
    expect(stats[0].modelId).toBe("fake-model");
  });

  it("deleteCollection clears all data", async () => {
    await service.index("test-items", [
      { id: "a", content: "alpha" },
    ]);

    const removed = service.deleteCollection("test-items");
    expect(removed).toBe(1);
    expect(service.stats("test-items")).toHaveLength(0);
  });
});
