import type {
  ProviderConfig,
  ModelCapabilities,
  TaskRequirements,
  RankedProvider,
  PatternStats,
  PatternMeta,
} from "../types.js";
import type { ExecutionMemory } from "../memory/execution-memory.js";

/**
 * CapabilityProviderSelector – picks the cheapest provider that can
 * satisfy a pattern's capability requirements, adjusted by execution memory.
 *
 * This is a *new* selector for the score-based capability system and lives
 * alongside the existing tag-based `ProviderSelector` in `provider-selector.ts`.
 *
 * Selection logic:
 *   1. Filter providers by hard capability requirements (reasoning ≥ X, etc.)
 *   2. Disqualify providers with a poor track record for this pattern
 *   3. Sort by cost tier ascending (cheapest first), break ties by success rate
 *   4. Fall back to the most capable (most expensive) provider if none match
 */

const MIN_RUNS_FOR_TRUST = 5;
const SUCCESS_RATE_THRESHOLD = 80;
const PROMOTION_THRESHOLD = 95;
const PROMOTION_MIN_RUNS = 10;

const DEFAULT_REQUIREMENTS: TaskRequirements = {
  instruction_following: 5,
};

export class CapabilityProviderSelector {
  constructor(
    private providers: Record<string, ProviderConfig>,
    private memory: ExecutionMemory,
  ) {}

  /**
   * Select the best provider for a pattern based on requirements + memory.
   * Throws never — always returns something (fallback to most capable).
   */
  select(patternMeta: PatternMeta): RankedProvider {
    const requirements = patternMeta.requires ?? DEFAULT_REQUIREMENTS;
    const stats = this.memory.getStats(patternMeta.name);
    const statsMap = new Map(stats.map((s) => [s.provider, s]));

    const candidates = Object.entries(this.providers)
      .map(([name, config]) => this.evaluate(name, config, requirements, statsMap))
      .filter((c) => c.capable)
      .sort((a, b) => {
        if (a.costTier !== b.costTier) return a.costTier - b.costTier;
        const aRate = a.history?.successRate ?? 50;
        const bRate = b.history?.successRate ?? 50;
        return bRate - aRate;
      });

    if (candidates.length === 0) {
      return this.fallbackToMostCapable();
    }
    return candidates[0];
  }

  /**
   * Next-more-expensive provider for escalation after a failure.
   * Returns null when no upgrade is available (already on top tier).
   */
  selectUpgrade(currentProvider: string, patternMeta: PatternMeta): RankedProvider | null {
    const currentTier = this.providers[currentProvider]?.cost?.tier ?? 99;
    const requirements = patternMeta.requires ?? DEFAULT_REQUIREMENTS;

    const upgrades = Object.entries(this.providers)
      .filter(([name, config]) =>
        name !== currentProvider &&
        (config.cost?.tier ?? 99) > currentTier &&
        this.meetsRequirements(config, requirements),
      )
      .sort(([, a], [, b]) => (a.cost?.tier ?? 99) - (b.cost?.tier ?? 99));

    if (upgrades.length === 0) return null;

    const [name, config] = upgrades[0];
    return {
      name,
      config,
      capable: true,
      costTier: config.cost?.tier ?? 99,
      headroom: this.calcHeadroom(config, requirements),
    };
  }

  /** List all providers with their evaluation for debugging / CLI inspection. */
  rankAll(patternMeta: PatternMeta): RankedProvider[] {
    const requirements = patternMeta.requires ?? DEFAULT_REQUIREMENTS;
    const stats = this.memory.getStats(patternMeta.name);
    const statsMap = new Map(stats.map((s) => [s.provider, s]));

    return Object.entries(this.providers)
      .map(([name, config]) => this.evaluate(name, config, requirements, statsMap))
      .sort((a, b) => a.costTier - b.costTier);
  }

  // ─── Private ────────────────────────────────────────

  private evaluate(
    name: string,
    config: ProviderConfig,
    requirements: TaskRequirements,
    statsMap: Map<string, PatternStats>,
  ): RankedProvider {
    const capable = this.meetsRequirements(config, requirements);
    const history = statsMap.get(name);

    // Memory disqualification: enough data + poor success rate
    let memoryDisqualified = false;
    if (
      history &&
      history.totalRuns >= MIN_RUNS_FOR_TRUST &&
      history.successRate < SUCCESS_RATE_THRESHOLD
    ) {
      memoryDisqualified = true;
    }

    // Promotion bonus: very reliable → effective tier slightly reduced
    let effectiveTier = config.cost?.tier ?? 99;
    if (
      history &&
      history.totalRuns >= PROMOTION_MIN_RUNS &&
      history.successRate >= PROMOTION_THRESHOLD
    ) {
      effectiveTier -= 0.5;
    }

    return {
      name,
      config,
      capable: capable && !memoryDisqualified,
      costTier: effectiveTier,
      headroom: this.calcHeadroom(config, requirements),
      history,
    };
  }

  private meetsRequirements(config: ProviderConfig, reqs: TaskRequirements): boolean {
    const caps = config.model_capabilities;
    if (!caps) return true; // Without capabilities declared → assume capable (backward-compat)

    if (reqs.reasoning !== undefined && caps.reasoning < reqs.reasoning) return false;
    if (reqs.code_generation !== undefined && caps.code_generation < reqs.code_generation) return false;
    if (reqs.instruction_following !== undefined && caps.instruction_following < reqs.instruction_following) return false;
    if (reqs.structured_output !== undefined && caps.structured_output < reqs.structured_output) return false;
    if (reqs.language && !caps.language.includes(reqs.language)) return false;
    if (reqs.min_context !== undefined && caps.max_context < reqs.min_context) return false;

    return true;
  }

  private calcHeadroom(config: ProviderConfig, reqs: TaskRequirements): number {
    const caps = config.model_capabilities;
    if (!caps) return 0;

    const dimensions: [keyof TaskRequirements, keyof ModelCapabilities][] = [
      ["reasoning", "reasoning"],
      ["code_generation", "code_generation"],
      ["instruction_following", "instruction_following"],
      ["structured_output", "structured_output"],
    ];

    let total = 0;
    let count = 0;
    for (const [reqKey, capKey] of dimensions) {
      const reqVal = reqs[reqKey] as number | undefined;
      if (reqVal !== undefined) {
        total += (caps[capKey] as number) - reqVal;
        count++;
      }
    }

    return count > 0 ? total / count : 0;
  }

  private fallbackToMostCapable(): RankedProvider {
    const entries = Object.entries(this.providers);
    if (entries.length === 0) {
      throw new Error("CapabilityProviderSelector: no providers configured");
    }
    const sorted = entries.sort(
      ([, a], [, b]) => (b.cost?.tier ?? 0) - (a.cost?.tier ?? 0),
    );
    const [name, config] = sorted[0];
    return {
      name,
      config,
      capable: true, // Assume the most expensive provider can handle anything
      costTier: config.cost?.tier ?? 99,
      headroom: 0,
    };
  }
}
