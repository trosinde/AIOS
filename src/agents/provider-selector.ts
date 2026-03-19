import type { LLMProvider } from "./provider.js";
import type { ProviderConfig, SelectionStrategy } from "../types.js";

/**
 * Cost-based capability-aware provider selection.
 * Finds the cheapest available provider that supports a given capability.
 * Providers without API keys (except Ollama) are silently skipped.
 */
export class ProviderSelector {
  private providers: Map<string, LLMProvider>;
  private configs: Record<string, ProviderConfig>;

  constructor(
    providers: Map<string, LLMProvider>,
    configs: Record<string, ProviderConfig>,
  ) {
    this.providers = providers;
    this.configs = configs;
  }

  /** Get a specific named provider */
  getByName(name: string): { name: string; provider: LLMProvider } | undefined {
    const provider = this.providers.get(name);
    return provider ? { name, provider } : undefined;
  }

  /** Find provider with the required capability using the given strategy */
  select(capability: string, strategy: SelectionStrategy = "cheapest"): { name: string; provider: LLMProvider } | undefined {
    const candidates = Object.entries(this.configs)
      .filter(([name, cfg]) => {
        if (!cfg.capabilities?.includes(capability)) return false;
        // Skip providers without API key (except ollama which may not need one)
        if (cfg.type !== "ollama" && !cfg.apiKey) return false;
        return this.providers.has(name);
      });

    if (strategy === "best") {
      const defaultQuality = 5;
      candidates.sort(([, a], [, b]) =>
        (b.quality?.[capability] ?? defaultQuality) - (a.quality?.[capability] ?? defaultQuality)
      );
    } else {
      candidates.sort(([, a], [, b]) => (a.cost_per_mtok ?? 0) - (b.cost_per_mtok ?? 0));
    }

    if (candidates.length === 0) return undefined;
    const [name] = candidates[0];
    return { name, provider: this.providers.get(name)! };
  }
}
