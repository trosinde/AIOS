import { describe, it, expect } from "vitest";
import { ProviderSelector } from "./provider-selector.js";
import type { LLMProvider } from "./provider.js";
import type { ProviderConfig } from "../types.js";

function mockProvider(): LLMProvider {
  return {
    complete: async () => ({ content: "ok", model: "test", tokensUsed: { input: 0, output: 0 } }),
    chat: async () => ({ content: "ok", model: "test", tokensUsed: { input: 0, output: 0 } }),
  };
}

describe("ProviderSelector", () => {
  it("selects cheapest provider with requested capability", () => {
    const providers = new Map<string, LLMProvider>([
      ["ollama-vision", mockProvider()],
      ["gemini", mockProvider()],
      ["claude", mockProvider()],
    ]);
    const configs: Record<string, ProviderConfig> = {
      "ollama-vision": { type: "ollama", model: "minicpm-v", capabilities: ["vision"], cost_per_mtok: 0 },
      gemini: { type: "gemini", model: "gemini-2.0-flash", apiKey: "key", capabilities: ["vision", "text"], cost_per_mtok: 0.075 },
      claude: { type: "anthropic", model: "claude-sonnet", apiKey: "key", capabilities: ["vision", "text"], cost_per_mtok: 3.0 },
    };

    const selector = new ProviderSelector(providers, configs);
    const result = selector.select("vision");
    expect(result).toBeDefined();
    expect(result!.name).toBe("ollama-vision");
  });

  it("skips providers without API key (except ollama)", () => {
    const providers = new Map<string, LLMProvider>([
      ["gemini", mockProvider()],
      ["claude", mockProvider()],
    ]);
    const configs: Record<string, ProviderConfig> = {
      gemini: { type: "gemini", model: "gemini-2.0-flash", capabilities: ["vision"], cost_per_mtok: 0.075 },
      claude: { type: "anthropic", model: "claude-sonnet", apiKey: "key", capabilities: ["vision"], cost_per_mtok: 3.0 },
    };

    const selector = new ProviderSelector(providers, configs);
    const result = selector.select("vision");
    expect(result).toBeDefined();
    expect(result!.name).toBe("claude");
  });

  it("returns undefined when no provider has the capability", () => {
    const providers = new Map<string, LLMProvider>([
      ["ollama", mockProvider()],
    ]);
    const configs: Record<string, ProviderConfig> = {
      ollama: { type: "ollama", model: "llama3", capabilities: ["text"], cost_per_mtok: 0 },
    };

    const selector = new ProviderSelector(providers, configs);
    expect(selector.select("vision")).toBeUndefined();
  });

  it("returns undefined when no providers are configured", () => {
    const selector = new ProviderSelector(new Map(), {});
    expect(selector.select("vision")).toBeUndefined();
  });

  it("sorts by cost ascending — picks cheapest", () => {
    const providers = new Map<string, LLMProvider>([
      ["expensive", mockProvider()],
      ["cheap", mockProvider()],
      ["mid", mockProvider()],
    ]);
    const configs: Record<string, ProviderConfig> = {
      expensive: { type: "anthropic", model: "claude", apiKey: "k", capabilities: ["vision"], cost_per_mtok: 3.0 },
      cheap: { type: "gemini", model: "flash", apiKey: "k", capabilities: ["vision"], cost_per_mtok: 0.075 },
      mid: { type: "openai", model: "gpt", apiKey: "k", capabilities: ["vision"], cost_per_mtok: 0.15 },
    };

    const selector = new ProviderSelector(providers, configs);
    const result = selector.select("vision");
    expect(result!.name).toBe("cheap");
  });

  it("skips provider not in providers map", () => {
    const providers = new Map<string, LLMProvider>([
      ["claude", mockProvider()],
    ]);
    const configs: Record<string, ProviderConfig> = {
      "missing-provider": { type: "ollama", model: "test", capabilities: ["vision"], cost_per_mtok: 0 },
      claude: { type: "anthropic", model: "claude", apiKey: "k", capabilities: ["vision"], cost_per_mtok: 3.0 },
    };

    const selector = new ProviderSelector(providers, configs);
    const result = selector.select("vision");
    expect(result!.name).toBe("claude");
  });
});
