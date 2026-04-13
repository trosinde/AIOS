import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaEmbedder } from "./ollama-embedder.js";

describe("OllamaEmbedder", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── Constructor ─────────────────────────────────────────

  it("uses default model and endpoint", () => {
    const embedder = new OllamaEmbedder();
    expect(embedder.modelId).toBe("all-minilm");
    expect(embedder.dimensions).toBe(0);
  });

  it("accepts custom model, endpoint, and apiKey", () => {
    const embedder = new OllamaEmbedder("nomic-embed-text", "http://custom:1234", "secret");
    expect(embedder.modelId).toBe("nomic-embed-text");
  });

  // ─── embed() ─────────────────────────────────────────────

  it("sends correct request and returns Float32Array", async () => {
    const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: mockEmbedding }),
    });

    const embedder = new OllamaEmbedder("test-model", "http://localhost:11434");
    const result = await embedder.embed("hello");

    expect(result).toBeInstanceOf(Float32Array);
    expect(result).toEqual(new Float32Array(mockEmbedding));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embeddings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "test-model", prompt: "hello" }),
      }),
    );
  });

  it("sets dimensions after first embed", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
    });

    const embedder = new OllamaEmbedder();
    expect(embedder.dimensions).toBe(0);
    await embedder.embed("test");
    expect(embedder.dimensions).toBe(3);
  });

  it("includes Authorization header when apiKey provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [0.1] }),
    });

    const embedder = new OllamaEmbedder("m", "http://localhost:11434", "my-key");
    await embedder.embed("test");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer my-key" }),
    );
  });

  it("does not include Authorization header when no apiKey", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [0.1] }),
    });

    const embedder = new OllamaEmbedder("m", "http://localhost:11434");
    await embedder.embed("test");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers).not.toHaveProperty("Authorization");
  });

  // ─── Error handling ──────────────────────────────────────

  it("throws on HTTP error response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const embedder = new OllamaEmbedder();
    await expect(embedder.embed("test")).rejects.toThrow(
      "Ollama embeddings error: 500 Internal Server Error",
    );
  });

  it("throws on API error in response body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: "model not found" }),
    });

    const embedder = new OllamaEmbedder();
    await expect(embedder.embed("test")).rejects.toThrow(
      "Ollama embeddings: model not found",
    );
  });

  it("throws when response has no embedding field", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const embedder = new OllamaEmbedder();
    await expect(embedder.embed("test")).rejects.toThrow(
      "Ollama: keine Embedding-Antwort erhalten",
    );
  });

  it("throws on network error (fetch rejects)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const embedder = new OllamaEmbedder();
    await expect(embedder.embed("test")).rejects.toThrow("ECONNREFUSED");
  });

  // ─── embedBatch() ────────────────────────────────────────

  it("processes batch sequentially and returns all results", async () => {
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const idx = callIndex++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ embedding: [idx * 0.1, idx * 0.2] }),
      });
    });

    const embedder = new OllamaEmbedder();
    const results = await embedder.embedBatch(["a", "b", "c"], 2);

    expect(results).toHaveLength(3);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    results.forEach((r) => expect(r).toBeInstanceOf(Float32Array));
  });

  it("embedBatch with empty array returns empty", async () => {
    globalThis.fetch = vi.fn();
    const embedder = new OllamaEmbedder();
    const results = await embedder.embedBatch([]);
    expect(results).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
