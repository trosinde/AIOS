import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CapabilityProviderSelector } from "./selector.js";
import { ExecutionMemory } from "../memory/execution-memory.js";
import type { ProviderConfig, PatternMeta } from "../types.js";

function caps(
  overrides: Partial<ProviderConfig["model_capabilities"]> = {},
): NonNullable<ProviderConfig["model_capabilities"]> {
  return {
    reasoning: 5,
    code_generation: 5,
    instruction_following: 5,
    structured_output: 5,
    language: ["en"],
    max_context: 32000,
    ...overrides,
  };
}

function tier(t: number) {
  return { tier: t, input_per_mtok: 0, output_per_mtok: 0 };
}

function meta(overrides: Partial<PatternMeta> = {}): PatternMeta {
  return {
    name: "summarize",
    description: "",
    category: "transform",
    input_type: "text",
    output_type: "text",
    tags: [],
    ...overrides,
  };
}

function makeMemory(): ExecutionMemory {
  const dir = mkdtempSync(join(tmpdir(), "aios-sel-"));
  return new ExecutionMemory(join(dir, "memory.json"));
}

describe("CapabilityProviderSelector", () => {
  let memory: ExecutionMemory;

  beforeEach(() => {
    memory = makeMemory();
  });

  it("selects the cheapest capable provider", () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ reasoning: 7 }),
        cost: tier(1),
      },
      mid: {
        type: "ollama",
        model: "m2",
        model_capabilities: caps({ reasoning: 8 }),
        cost: tier(2),
      },
      expensive: {
        type: "anthropic",
        model: "m3",
        model_capabilities: caps({ reasoning: 9 }),
        cost: tier(3),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const choice = selector.select(meta({ requires: { reasoning: 7 } }));
    expect(choice.name).toBe("cheap");
  });

  it("skips providers with insufficient reasoning", () => {
    const providers: Record<string, ProviderConfig> = {
      weak: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ reasoning: 4 }),
        cost: tier(1),
      },
      strong: {
        type: "anthropic",
        model: "m2",
        model_capabilities: caps({ reasoning: 9 }),
        cost: tier(3),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const choice = selector.select(meta({ requires: { reasoning: 8 } }));
    expect(choice.name).toBe("strong");
  });

  it("skips providers lacking the required language", () => {
    const providers: Record<string, ProviderConfig> = {
      en_only: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ language: ["en"] }),
        cost: tier(1),
      },
      german: {
        type: "ollama",
        model: "m2",
        model_capabilities: caps({ language: ["de", "en"] }),
        cost: tier(2),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const choice = selector.select(meta({ requires: { language: "de" } }));
    expect(choice.name).toBe("german");
  });

  it("provider without model_capabilities is considered capable (backward-compat)", () => {
    const providers: Record<string, ProviderConfig> = {
      legacy: { type: "ollama", model: "m1", cost: tier(1) },
      scored: {
        type: "anthropic",
        model: "m2",
        model_capabilities: caps({ reasoning: 9 }),
        cost: tier(3),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const choice = selector.select(meta({ requires: { reasoning: 8 } }));
    expect(choice.name).toBe("legacy"); // No caps → assumed capable, cheaper wins
  });

  it("memory disqualification skips unreliable providers", () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ reasoning: 7 }),
        cost: tier(1),
      },
      expensive: {
        type: "anthropic",
        model: "m2",
        model_capabilities: caps({ reasoning: 9 }),
        cost: tier(3),
      },
    };

    // Log 6 first-attempt failures for the cheap provider
    for (let i = 0; i < 6; i++) {
      memory.log({
        timestamp: new Date().toISOString(),
        pattern: "summarize",
        provider: "cheap",
        model: "m1",
        costTier: 1,
        outcome: i < 1 ? "success" : "failed", // ~17% success
        attempt: 1,
        durationMs: 400,
        tokensInput: 0,
        tokensOutput: 0,
      });
    }

    const selector = new CapabilityProviderSelector(providers, memory);
    const choice = selector.select(meta({ requires: { reasoning: 7 } }));
    expect(choice.name).toBe("expensive");
  });

  it("promotion bonus for high-reliability providers", () => {
    const providers: Record<string, ProviderConfig> = {
      tier2: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ reasoning: 7 }),
        cost: tier(2),
      },
      tier3: {
        type: "anthropic",
        model: "m2",
        model_capabilities: caps({ reasoning: 9 }),
        cost: tier(3),
      },
    };

    // tier2 has 10 successes → promotion bonus should kick in (tier 1.5)
    for (let i = 0; i < 10; i++) {
      memory.log({
        timestamp: new Date().toISOString(),
        pattern: "summarize",
        provider: "tier2",
        model: "m1",
        costTier: 2,
        outcome: "success",
        attempt: 1,
        durationMs: 400,
        tokensInput: 0,
        tokensOutput: 0,
      });
    }

    const selector = new CapabilityProviderSelector(providers, memory);
    const ranked = selector.rankAll(meta({ requires: { reasoning: 7 } }));
    const tier2 = ranked.find((r) => r.name === "tier2")!;
    expect(tier2.costTier).toBe(1.5); // 2 − 0.5 promotion bonus
  });

  it("fallback returns most expensive provider when none matches requirements", () => {
    const providers: Record<string, ProviderConfig> = {
      weak: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ reasoning: 3 }),
        cost: tier(1),
      },
      stronger: {
        type: "anthropic",
        model: "m2",
        model_capabilities: caps({ reasoning: 6 }),
        cost: tier(3),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    // Require reasoning 10 – nobody matches → fallback
    const choice = selector.select(meta({ requires: { reasoning: 10 } }));
    expect(choice.name).toBe("stronger");
  });

  it("selectUpgrade returns next-more-expensive capable provider", () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ reasoning: 7 }),
        cost: tier(1),
      },
      mid: {
        type: "ollama",
        model: "m2",
        model_capabilities: caps({ reasoning: 8 }),
        cost: tier(2),
      },
      expensive: {
        type: "anthropic",
        model: "m3",
        model_capabilities: caps({ reasoning: 9 }),
        cost: tier(3),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const upgrade = selector.selectUpgrade("cheap", meta({ requires: { reasoning: 7 } }));
    expect(upgrade?.name).toBe("mid");
  });

  it("selectUpgrade returns null when already on top tier", () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ reasoning: 7 }),
        cost: tier(1),
      },
      expensive: {
        type: "anthropic",
        model: "m2",
        model_capabilities: caps({ reasoning: 9 }),
        cost: tier(3),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const upgrade = selector.selectUpgrade("expensive", meta({ requires: { reasoning: 7 } }));
    expect(upgrade).toBeNull();
  });

  it("default requirements apply when pattern has no requires", () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ instruction_following: 5 }),
        cost: tier(1),
      },
      weak: {
        type: "ollama",
        model: "m2",
        model_capabilities: caps({ instruction_following: 4 }), // below default 5
        cost: tier(1),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const choice = selector.select(meta()); // no requires
    expect(choice.name).toBe("cheap");
  });

  it("breaks ties by success rate within same tier", () => {
    const providers: Record<string, ProviderConfig> = {
      p1: {
        type: "ollama",
        model: "m1",
        model_capabilities: caps({ reasoning: 7 }),
        cost: tier(1),
      },
      p2: {
        type: "ollama",
        model: "m2",
        model_capabilities: caps({ reasoning: 7 }),
        cost: tier(1),
      },
    };
    // p1: 10 successes, p2: 5 successes + 5 failures (still above the 80% disqualification)
    // Wait — 5/10 = 50% would be disqualified. Give p2 8/10 = 80%.
    for (let i = 0; i < 10; i++) {
      memory.log({
        timestamp: new Date().toISOString(),
        pattern: "summarize",
        provider: "p1",
        model: "m1",
        costTier: 1,
        outcome: "success",
        attempt: 1,
        durationMs: 400,
        tokensInput: 0,
        tokensOutput: 0,
      });
    }
    for (let i = 0; i < 10; i++) {
      memory.log({
        timestamp: new Date().toISOString(),
        pattern: "summarize",
        provider: "p2",
        model: "m2",
        costTier: 1,
        outcome: i < 8 ? "success" : "failed",
        attempt: 1,
        durationMs: 400,
        tokensInput: 0,
        tokensOutput: 0,
      });
    }

    const selector = new CapabilityProviderSelector(providers, memory);
    const choice = selector.select(meta({ requires: { reasoning: 7 } }));
    // Both same tier (p1 gets tier 0.5 promotion), p1 has higher rate → p1 wins
    expect(choice.name).toBe("p1");
  });
});
