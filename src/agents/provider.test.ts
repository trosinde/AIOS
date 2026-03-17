import { describe, it, expect } from "vitest";
import { createProvider } from "./provider.js";
import type { ProviderConfig } from "../types.js";

describe("createProvider", () => {
  it("erstellt ClaudeProvider für anthropic type", () => {
    const config: ProviderConfig = { type: "anthropic", model: "claude-sonnet-4-20250514" };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.complete).toBeTypeOf("function");
  });

  it("erstellt OllamaProvider für ollama type", () => {
    const config: ProviderConfig = { type: "ollama", model: "llama3", endpoint: "http://localhost:11434" };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.complete).toBeTypeOf("function");
  });

  it("wirft Fehler für unbekannten Provider-Typ", () => {
    const config = { type: "unknown", model: "test" } as unknown as ProviderConfig;
    expect(() => createProvider(config)).toThrow("Unknown provider type");
  });

  it("OllamaProvider nutzt Default-Endpoint wenn keiner angegeben", () => {
    const config: ProviderConfig = { type: "ollama", model: "llama3" };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
  });
});
