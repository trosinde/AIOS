import { describe, it, expect, vi } from "vitest";

vi.mock("./local-embedder.js", () => ({
  LocalEmbedder: vi.fn().mockImplementation(function (this: Record<string, string>, model: string) {
    this.type = "local";
    this.model = model;
  }),
}));

vi.mock("./ollama-embedder.js", () => ({
  OllamaEmbedder: vi.fn().mockImplementation(function (this: Record<string, string | undefined>, model: string, endpoint?: string, apiKey?: string) {
    this.type = "ollama";
    this.model = model;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }),
}));

import { createEmbeddingProvider } from "./embedding-provider.js";
import { LocalEmbedder } from "./local-embedder.js";
import { OllamaEmbedder } from "./ollama-embedder.js";

describe("createEmbeddingProvider", () => {
  it("creates LocalEmbedder for type 'local'", () => {
    const provider = createEmbeddingProvider({ type: "local", model: "all-MiniLM-L6-v2" });
    expect(LocalEmbedder).toHaveBeenCalledWith("all-MiniLM-L6-v2");
    expect(provider).toBeDefined();
  });

  it("creates OllamaEmbedder for type 'ollama'", () => {
    const provider = createEmbeddingProvider({
      type: "ollama",
      model: "nomic-embed-text",
      endpoint: "http://localhost:11434",
      apiKey: "test-key",
    });
    expect(OllamaEmbedder).toHaveBeenCalledWith("nomic-embed-text", "http://localhost:11434", "test-key");
    expect(provider).toBeDefined();
  });

  it("throws for unknown provider type", () => {
    expect(() =>
      createEmbeddingProvider({ type: "unknown" as "local", model: "test" })
    ).toThrow("Unknown embedding provider type: unknown");
  });

  it("passes undefined for optional ollama params", () => {
    createEmbeddingProvider({ type: "ollama", model: "embed" });
    expect(OllamaEmbedder).toHaveBeenCalledWith("embed", undefined, undefined);
  });
});
