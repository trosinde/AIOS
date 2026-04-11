import { describe, it, expect, vi } from "vitest";
import { join } from "path";
import { Router } from "./router.js";
import { PatternRegistry } from "./registry.js";
import type { LLMProvider } from "../agents/provider.js";
import type { LLMResponse } from "../types.js";

const PATTERNS_DIR = join(process.cwd(), "patterns");

function mockProvider(responseContent: string): LLMProvider {
  const response = {
    content: responseContent,
    model: "test-model",
    tokensUsed: { input: 100, output: 200 },
  } satisfies LLMResponse;
  return {
    complete: vi.fn().mockResolvedValue(response),
    chat: vi.fn().mockResolvedValue(response),
  };
}

function mockProviderSequence(...responses: string[]): LLMProvider {
  const fn = vi.fn();
  for (const content of responses) {
    fn.mockResolvedValueOnce({
      content,
      model: "test-model",
      tokensUsed: { input: 100, output: 200 },
    } satisfies LLMResponse);
  }
  return { complete: fn, chat: vi.fn() };
}

const VALID_PLAN_JSON = JSON.stringify({
  analysis: {
    goal: "Zusammenfassung erstellen",
    complexity: "low",
    requires_compliance: false,
    disciplines: ["transform"],
  },
  plan: {
    type: "pipe",
    steps: [
      {
        id: "step1",
        pattern: "summarize",
        depends_on: [],
        input_from: ["$USER_INPUT"],
        parallel_group: null,
        retry: null,
        quality_gate: null,
      },
    ],
  },
  reasoning: "Einfache Aufgabe, ein Pattern reicht",
});

describe("Router", () => {
  it("parst JSON aus LLM-Antwort", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider(VALID_PLAN_JSON);
    const router = new Router(registry, provider);

    const plan = await router.planWorkflow("Fasse diesen Text zusammen");
    expect(plan.analysis.goal).toBe("Zusammenfassung erstellen");
    expect(plan.plan.steps).toHaveLength(1);
    expect(plan.plan.steps[0].pattern).toBe("summarize");
  });

  it("parst JSON aus ```json``` Fenced Code Block", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const wrapped = "Hier ist mein Plan:\n\n```json\n" + VALID_PLAN_JSON + "\n```\n\nFertig.";
    const provider = mockProvider(wrapped);
    const router = new Router(registry, provider);

    const plan = await router.planWorkflow("Test");
    expect(plan.plan.type).toBe("pipe");
  });

  it("wirft Fehler bei ungültigem JSON", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider("Das ist kein JSON");
    const router = new Router(registry, provider);

    await expect(router.planWorkflow("Test")).rejects.toThrow("keinen gültigen Plan");
  });

  it("wirft Fehler bei nicht-existierendem Pattern nach Retry", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const badPlan = JSON.stringify({
      analysis: { goal: "test", complexity: "low", requires_compliance: false, disciplines: [] },
      plan: {
        type: "pipe",
        steps: [{ id: "s1", pattern: "nonexistent", depends_on: [], input_from: ["$USER_INPUT"] }],
      },
      reasoning: "test",
    });
    // Both initial and retry return all-invalid plans
    const provider = mockProviderSequence(badPlan, badPlan);
    const router = new Router(registry, provider);

    await expect(router.planWorkflow("Test")).rejects.toThrow("alle Patterns ungültig");
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("retries with correction and succeeds", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const badPlan = JSON.stringify({
      analysis: { goal: "test", complexity: "low", requires_compliance: false, disciplines: [] },
      plan: {
        type: "pipe",
        steps: [{ id: "s1", pattern: "clarify_requirements", depends_on: [], input_from: ["$USER_INPUT"] }],
      },
      reasoning: "test",
    });
    // First call: bad pattern, second call: valid pattern
    const provider = mockProviderSequence(badPlan, VALID_PLAN_JSON);
    const router = new Router(registry, provider);

    const plan = await router.planWorkflow("Test");
    expect(plan.plan.steps[0].pattern).toBe("summarize");
    expect(provider.complete).toHaveBeenCalledTimes(2);
    // Verify retry prompt contains correction
    const retryCall = vi.mocked(provider.complete).mock.calls[1];
    expect(retryCall[1]).toContain("KORREKTUR");
    expect(retryCall[1]).toContain("clarify_requirements");
  });

  it("filters invalid steps after failed retry, keeps valid ones", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const mixedPlan = JSON.stringify({
      analysis: { goal: "test", complexity: "low", requires_compliance: false, disciplines: [] },
      plan: {
        type: "pipe",
        steps: [
          { id: "s1", pattern: "summarize", depends_on: [], input_from: ["$USER_INPUT"] },
          { id: "s2", pattern: "nonexistent", depends_on: [], input_from: ["$USER_INPUT"] },
        ],
      },
      reasoning: "test",
    });
    // Both calls return the same mixed plan
    const provider = mockProviderSequence(mixedPlan, mixedPlan);
    const router = new Router(registry, provider);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const plan = await router.planWorkflow("Test");
    expect(plan.plan.steps).toHaveLength(1);
    expect(plan.plan.steps[0].pattern).toBe("summarize");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("nonexistent"));

    consoleSpy.mockRestore();
  });

  it("cleans up depends_on/input_from refs to filtered steps", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const planWithDeps = JSON.stringify({
      analysis: { goal: "test", complexity: "low", requires_compliance: false, disciplines: [] },
      plan: {
        type: "dag",
        steps: [
          { id: "s1", pattern: "nonexistent", depends_on: [], input_from: ["$USER_INPUT"] },
          { id: "s2", pattern: "summarize", depends_on: ["s1"], input_from: ["s1"] },
        ],
      },
      reasoning: "test",
    });
    const provider = mockProviderSequence(planWithDeps, planWithDeps);
    const router = new Router(registry, provider);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const plan = await router.planWorkflow("Test");
    expect(plan.plan.steps).toHaveLength(1);
    expect(plan.plan.steps[0].id).toBe("s2");
    expect(plan.plan.steps[0].depends_on).toEqual([]);
    expect(plan.plan.steps[0].input_from).toEqual(["$USER_INPUT"]);

    vi.restoreAllMocks();
  });

  it("wirft Fehler bei ungültiger Dependency", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const badPlan = JSON.stringify({
      analysis: { goal: "test", complexity: "low", requires_compliance: false, disciplines: [] },
      plan: {
        type: "pipe",
        steps: [{ id: "s1", pattern: "summarize", depends_on: ["nonexistent"], input_from: ["$USER_INPUT"] }],
      },
      reasoning: "test",
    });
    const provider = mockProvider(badPlan);
    const router = new Router(registry, provider);

    await expect(router.planWorkflow("Test")).rejects.toThrow('Dependency "nonexistent"');
  });

  it("übergibt Pattern-Katalog an Provider", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider(VALID_PLAN_JSON);
    const router = new Router(registry, provider);

    await router.planWorkflow("Test");
    const call = vi.mocked(provider.complete).mock.calls[0];
    expect(call[1]).toContain("VERFÜGBARE PATTERNS");
    expect(call[1]).toContain("summarize");
  });
});
