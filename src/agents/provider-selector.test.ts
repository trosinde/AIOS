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

  // ─── getByName ──────────────────────────────────────────

  it("getByName returns correct provider", () => {
    const providers = new Map<string, LLMProvider>([
      ["claude", mockProvider()],
    ]);
    const configs: Record<string, ProviderConfig> = {
      claude: { type: "anthropic", model: "claude", apiKey: "k", capabilities: ["vision"], cost_per_mtok: 3.0 },
    };

    const selector = new ProviderSelector(providers, configs);
    const result = selector.getByName("claude");
    expect(result).toBeDefined();
    expect(result!.name).toBe("claude");
  });

  it("getByName returns undefined for unknown provider", () => {
    const selector = new ProviderSelector(new Map(), {});
    expect(selector.getByName("nonexistent")).toBeUndefined();
  });

  // ─── Strategy: best ──────────────────────────────────────

  it("select with 'best' strategy picks highest quality score", () => {
    const providers = new Map<string, LLMProvider>([
      ["cheap", mockProvider()],
      ["quality", mockProvider()],
    ]);
    const configs: Record<string, ProviderConfig> = {
      cheap: { type: "gemini", model: "flash", apiKey: "k", capabilities: ["vision"], cost_per_mtok: 0.075, quality: { vision: 6 } },
      quality: { type: "anthropic", model: "claude", apiKey: "k", capabilities: ["vision"], cost_per_mtok: 3.0, quality: { vision: 9 } },
    };

    const selector = new ProviderSelector(providers, configs);
    const result = selector.select("vision", "best");
    expect(result!.name).toBe("quality");
  });

  it("select with 'cheapest' strategy still picks cheapest", () => {
    const providers = new Map<string, LLMProvider>([
      ["cheap", mockProvider()],
      ["quality", mockProvider()],
    ]);
    const configs: Record<string, ProviderConfig> = {
      cheap: { type: "gemini", model: "flash", apiKey: "k", capabilities: ["vision"], cost_per_mtok: 0.075, quality: { vision: 6 } },
      quality: { type: "anthropic", model: "claude", apiKey: "k", capabilities: ["vision"], cost_per_mtok: 3.0, quality: { vision: 9 } },
    };

    const selector = new ProviderSelector(providers, configs);
    const result = selector.select("vision", "cheapest");
    expect(result!.name).toBe("cheap");
  });

  it("uses default quality score (5) when quality not configured", () => {
    const providers = new Map<string, LLMProvider>([
      ["no-quality", mockProvider()],
      ["with-quality", mockProvider()],
    ]);
    const configs: Record<string, ProviderConfig> = {
      "no-quality": { type: "ollama", model: "test", capabilities: ["code"], cost_per_mtok: 0 },
      "with-quality": { type: "gemini", model: "flash", apiKey: "k", capabilities: ["code"], cost_per_mtok: 0.1, quality: { code: 8 } },
    };

    const selector = new ProviderSelector(providers, configs);
    // "with-quality" has quality 8, "no-quality" defaults to 5 → "with-quality" wins
    const result = selector.select("code", "best");
    expect(result!.name).toBe("with-quality");
  });
});
