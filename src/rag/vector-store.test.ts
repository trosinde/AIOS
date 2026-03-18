import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VectorStore } from "./vector-store.js";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/** Create a fake normalized embedding */
function fakeEmbedding(dims: number, seed: number = 0): Float32Array {
  const arr = new Float32Array(dims);
  for (let i = 0; i < dims; i++) {
    arr[i] = Math.sin(seed + i);
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < dims; i++) arr[i] /= norm;
  return arr;
}

describe("VectorStore", () => {
  let store: VectorStore;
  const dbPath = join(tmpdir(), `aios-vector-test-${Date.now()}.db`);

  beforeEach(() => {
    store = new VectorStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-wal"); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* ignore */ }
  });

  it("upsert and search finds similar vectors", () => {
    const dims = 8;
    const embedding1 = fakeEmbedding(dims, 0);
    const embedding2 = fakeEmbedding(dims, 0.1); // very similar
    const embedding3 = fakeEmbedding(dims, 100); // very different

    store.upsert({
      id: "doc1", collection: "test", chunkIndex: 0,
      content: "First document", metadata: { type: "a" },
      embedding: embedding1, modelId: "test-model", createdAt: new Date().toISOString(),
    });
    store.upsert({
      id: "doc2", collection: "test", chunkIndex: 0,
      content: "Second document", metadata: { type: "b" },
      embedding: embedding3, modelId: "test-model", createdAt: new Date().toISOString(),
    });

    const results = store.search("test", embedding2, 10, 0);
    expect(results).toHaveLength(2);
    // doc1 should be more similar to query (seed 0.1) than doc3 (seed 100)
    expect(results[0].id).toBe("doc1");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("respects minScore filter", () => {
    const dims = 8;
    store.upsert({
      id: "doc1", collection: "test", chunkIndex: 0,
      content: "Match", metadata: {},
      embedding: fakeEmbedding(dims, 0), modelId: "m", createdAt: new Date().toISOString(),
    });
    store.upsert({
      id: "doc2", collection: "test", chunkIndex: 0,
      content: "No match", metadata: {},
      embedding: fakeEmbedding(dims, 100), modelId: "m", createdAt: new Date().toISOString(),
    });

    const results = store.search("test", fakeEmbedding(dims, 0), 10, 0.99);
    // Only exact match should pass with very high threshold
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("doc1");
  });

  it("filters by metadata", () => {
    const dims = 4;
    const emb = fakeEmbedding(dims, 0);
    store.upsert({
      id: "doc1", collection: "test", chunkIndex: 0,
      content: "A", metadata: { project: "alpha" },
      embedding: emb, modelId: "m", createdAt: new Date().toISOString(),
    });
    store.upsert({
      id: "doc2", collection: "test", chunkIndex: 0,
      content: "B", metadata: { project: "beta" },
      embedding: emb, modelId: "m", createdAt: new Date().toISOString(),
    });

    const results = store.search("test", emb, 10, 0, { project: "alpha" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("doc1");
  });

  it("upsertMany and stats", () => {
    const dims = 4;
    const docs = Array.from({ length: 5 }, (_, i) => ({
      id: `doc${i}`, collection: "bulk", chunkIndex: 0,
      content: `Document ${i}`, metadata: {},
      embedding: fakeEmbedding(dims, i), modelId: "m", createdAt: new Date().toISOString(),
    }));

    store.upsertMany(docs);
    const stats = store.stats("bulk");
    expect(stats).toHaveLength(1);
    expect(stats[0].documentCount).toBe(5);
  });

  it("delete removes document", () => {
    const dims = 4;
    store.upsert({
      id: "doc1", collection: "test", chunkIndex: 0,
      content: "A", metadata: {},
      embedding: fakeEmbedding(dims, 0), modelId: "m", createdAt: new Date().toISOString(),
    });

    expect(store.delete("test", "doc1")).toBe(true);
    expect(store.stats("test")).toHaveLength(0);
  });

  it("deleteCollection removes all", () => {
    const dims = 4;
    store.upsertMany([
      { id: "a", collection: "col1", chunkIndex: 0, content: "A", metadata: {}, embedding: fakeEmbedding(dims, 0), modelId: "m", createdAt: new Date().toISOString() },
      { id: "b", collection: "col1", chunkIndex: 0, content: "B", metadata: {}, embedding: fakeEmbedding(dims, 1), modelId: "m", createdAt: new Date().toISOString() },
    ]);

    const removed = store.deleteCollection("col1");
    expect(removed).toBe(2);
    expect(store.stats("col1")).toHaveLength(0);
  });

  it("needsReindex detects model change", () => {
    const dims = 4;
    store.upsert({
      id: "doc1", collection: "test", chunkIndex: 0,
      content: "A", metadata: {},
      embedding: fakeEmbedding(dims, 0), modelId: "model-v1", createdAt: new Date().toISOString(),
    });

    expect(store.needsReindex("test", "model-v1")).toBe(false);
    expect(store.needsReindex("test", "model-v2")).toBe(true);
    expect(store.needsReindex("empty", "model-v1")).toBe(false);
  });

  it("getEmbeddings returns embeddings by ID", () => {
    const dims = 4;
    const emb = fakeEmbedding(dims, 42);
    store.upsert({
      id: "doc1", collection: "test", chunkIndex: 0,
      content: "A", metadata: {},
      embedding: emb, modelId: "m", createdAt: new Date().toISOString(),
    });

    const result = store.getEmbeddings("test", ["doc1"]);
    expect(result.has("doc1")).toBe(true);
    const embeddings = result.get("doc1")!;
    expect(embeddings).toHaveLength(1);
    expect(embeddings[0].length).toBe(dims);
    // Verify values match
    for (let i = 0; i < dims; i++) {
      expect(embeddings[0][i]).toBeCloseTo(emb[i], 5);
    }
  });
});
