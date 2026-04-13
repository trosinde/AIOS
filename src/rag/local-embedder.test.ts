import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @xenova/transformers before importing the module
const mockPipeline = vi.fn();
vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn().mockImplementation(() => Promise.resolve(mockPipeline)),
}));

import { LocalEmbedder } from "./local-embedder.js";

describe("LocalEmbedder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mock pipeline returns a tensor-like object
    mockPipeline.mockResolvedValue({
      data: new Float32Array([0.1, 0.2, 0.3]),
      dims: [1, 3],
    });
  });

  it("uses default model when none specified", () => {
    const embedder = new LocalEmbedder();
    expect(embedder.modelId).toBe("Xenova/all-MiniLM-L6-v2");
  });

  it("accepts custom model name", () => {
    const embedder = new LocalEmbedder("custom/model");
    expect(embedder.modelId).toBe("custom/model");
  });

  it("reports dimensions as 0 before first embed", () => {
    const embedder = new LocalEmbedder();
    expect(embedder.dimensions).toBe(0);
  });

  it("embed() lazy-loads model and returns Float32Array", async () => {
    const embedder = new LocalEmbedder();
    const result = await embedder.embed("hello world");
    expect(result).toBeInstanceOf(Float32Array);
    expect(result).toEqual(new Float32Array([0.1, 0.2, 0.3]));
    // Pipeline was called twice: once for probe, once for actual embed
    expect(mockPipeline).toHaveBeenCalledTimes(2);
    // First call is the probe with "test"
    expect(mockPipeline).toHaveBeenNthCalledWith(1, "test", { pooling: "mean", normalize: true });
    // Second call is the actual text
    expect(mockPipeline).toHaveBeenNthCalledWith(2, "hello world", { pooling: "mean", normalize: true });
  });

  it("sets dimensions after first embed based on probe", async () => {
    mockPipeline.mockResolvedValue({
      data: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
      dims: [1, 5],
    });
    const embedder = new LocalEmbedder();
    await embedder.embed("test input");
    expect(embedder.dimensions).toBe(5);
  });

  it("only loads model once across multiple embed calls", async () => {
    const { pipeline: pipelineFactory } = await import("@xenova/transformers");
    const embedder = new LocalEmbedder();
    await embedder.embed("first");
    await embedder.embed("second");
    // pipeline factory should only be called once
    expect(pipelineFactory).toHaveBeenCalledTimes(1);
  });

  it("embedBatch processes all texts sequentially", async () => {
    const embedder = new LocalEmbedder();
    const results = await embedder.embedBatch(["a", "b", "c"], 2);
    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(r).toBeInstanceOf(Float32Array);
    });
    // 1 probe + 3 embeds = 4 calls
    expect(mockPipeline).toHaveBeenCalledTimes(4);
  });

  it("embedBatch with empty array returns empty", async () => {
    const embedder = new LocalEmbedder();
    const results = await embedder.embedBatch([]);
    expect(results).toEqual([]);
  });
});
