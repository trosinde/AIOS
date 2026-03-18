import type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";
import { LocalEmbedder } from "./local-embedder.js";
import { OllamaEmbedder } from "./ollama-embedder.js";

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.type) {
    case "local":
      return new LocalEmbedder(config.model);
    case "ollama":
      return new OllamaEmbedder(config.model, config.endpoint, config.apiKey);
    default:
      throw new Error(`Unknown embedding provider type: ${(config as EmbeddingProviderConfig).type}`);
  }
}
