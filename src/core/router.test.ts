import { describe, it, expect, vi } from "vitest";
import { join } from "path";
import { Router } from "./router.js";
import { PatternRegistry } from "./registry.js";
import type { LLMProvider } from "../agents/provider.js";
import type { LLMResponse } from "../types.js";

const PATTERNS_DIR = join(process.cwd(), "patterns");

function mockProvider(responseContent: string): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: responseContent,
      model: "test-model",
      tokensUsed: { input: 100, output: 200 },
    } satisfies LLMResponse),
  };
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

  it("wirft Fehler bei nicht-existierendem Pattern im Plan", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const badPlan = JSON.stringify({
      analysis: { goal: "test", complexity: "low", requires_compliance: false, disciplines: [] },
      plan: {
        type: "pipe",
        steps: [{ id: "s1", pattern: "nonexistent", depends_on: [], input_from: ["$USER_INPUT"] }],
      },
      reasoning: "test",
    });
    const provider = mockProvider(badPlan);
    const router = new Router(registry, provider);

    await expect(router.planWorkflow("Test")).rejects.toThrow("existiert nicht");
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
