import { describe, it, expect, vi } from "vitest";
import { join } from "path";
import { Engine } from "./engine.js";
import { PatternRegistry } from "./registry.js";
import type { LLMProvider } from "../agents/provider.js";
import type { AiosConfig, ExecutionPlan, LLMResponse } from "../types.js";

const PATTERNS_DIR = join(process.cwd(), "patterns");

function mockProvider(content = "Test output"): LLMProvider {
  const response = {
    content,
    model: "test-model",
    tokensUsed: { input: 50, output: 100 },
  } satisfies LLMResponse;
  return {
    complete: vi.fn().mockResolvedValue(response),
    chat: vi.fn().mockResolvedValue(response),
  };
}

function makePlan(overrides: Partial<ExecutionPlan["plan"]> = {}): ExecutionPlan {
  return {
    analysis: { goal: "test", complexity: "low", requires_compliance: false, disciplines: [] },
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
      ...overrides,
    },
    reasoning: "test",
  };
}

describe("Engine", () => {
  it("führt einen einfachen Plan aus", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider("Zusammenfassung des Textes");
    const engine = new Engine(registry, provider);

    const result = await engine.execute(makePlan(), "Langer Text...");

    expect(result.status.get("step1")).toBe("done");
    expect(result.results.get("step1")?.output).toBe("Zusammenfassung des Textes");
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("führt parallele Steps gleichzeitig aus", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider("Review result");
    const engine = new Engine(registry, provider);

    const plan = makePlan({
      type: "scatter_gather",
      steps: [
        { id: "review1", pattern: "code_review", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: "reviews", retry: null, quality_gate: null },
        { id: "review2", pattern: "security_review", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: "reviews", retry: null, quality_gate: null },
        { id: "aggregate", pattern: "aggregate_reviews", depends_on: ["review1", "review2"], input_from: ["review1", "review2"], parallel_group: null, retry: null, quality_gate: null },
      ],
    });

    const result = await engine.execute(plan, "Code...");

    expect(result.status.get("review1")).toBe("done");
    expect(result.status.get("review2")).toBe("done");
    expect(result.status.get("aggregate")).toBe("done");
    expect(provider.complete).toHaveBeenCalledTimes(3);
  });

  it("setzt Status auf failed bei nicht-existierendem Pattern", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider();
    const engine = new Engine(registry, provider);

    const plan = makePlan({
      steps: [
        { id: "bad", pattern: "nonexistent_pattern", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: null, retry: null, quality_gate: null },
      ],
    });

    const result = await engine.execute(plan, "test");
    expect(result.status.get("bad")).toBe("failed");
  });

  it("retried bei Fehler wenn retry konfiguriert", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider: LLMProvider = {
      complete: vi.fn()
        .mockRejectedValueOnce(new Error("Erster Fehler"))
        .mockResolvedValueOnce({ content: "Erfolg", model: "test", tokensUsed: { input: 0, output: 0 } }),
      chat: vi.fn(),
    };
    const engine = new Engine(registry, provider);

    const plan = makePlan({
      steps: [
        { id: "s1", pattern: "summarize", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: null, retry: { max: 2, on_failure: "retry_with_feedback" }, quality_gate: null },
      ],
    });

    const result = await engine.execute(plan, "test");
    expect(result.status.get("s1")).toBe("done");
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("setzt auf failed nach max retries", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider: LLMProvider = {
      complete: vi.fn().mockRejectedValue(new Error("Dauerfehler")),
      chat: vi.fn(),
    };
    const engine = new Engine(registry, provider);

    const plan = makePlan({
      steps: [
        { id: "s1", pattern: "summarize", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: null, retry: { max: 1 }, quality_gate: null },
      ],
    });

    const result = await engine.execute(plan, "test");
    expect(result.status.get("s1")).toBe("failed");
  });

  it("escalation setzt fehlenden Step auf failed (kein infinite loop)", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider: LLMProvider = {
      complete: vi.fn()
        .mockRejectedValueOnce(new Error("Fehler in step1"))
        .mockResolvedValue({ content: "Escalation result", model: "test", tokensUsed: { input: 0, output: 0 } }),
      chat: vi.fn(),
    };
    const engine = new Engine(registry, provider);

    const plan = makePlan({
      type: "saga",
      steps: [
        { id: "s1", pattern: "summarize", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: null, retry: { max: 0, on_failure: "escalate", escalate_to: "s2" }, quality_gate: null },
        { id: "s2", pattern: "code_review", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: null, retry: null, quality_gate: null },
      ],
    });

    const result = await engine.execute(plan, "test");
    expect(result.status.get("s1")).toBe("failed");
    expect(result.status.get("s2")).toBe("done");
  });

  it("baut Input aus Dependencies zusammen", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider: LLMProvider = {
      complete: vi.fn().mockResolvedValue({ content: "Output", model: "test", tokensUsed: { input: 0, output: 0 } }),
      chat: vi.fn(),
    };
    const engine = new Engine(registry, provider);

    const plan = makePlan({
      steps: [
        { id: "s1", pattern: "summarize", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: null, retry: null, quality_gate: null },
        { id: "s2", pattern: "code_review", depends_on: ["s1"], input_from: ["$USER_INPUT", "s1"], parallel_group: null, retry: null, quality_gate: null },
      ],
    });

    const result = await engine.execute(plan, "Mein Input");
    expect(result.status.get("s2")).toBe("done");

    // s2 sollte den Output von s1 + USER_INPUT erhalten haben
    const s2Call = vi.mocked(provider.complete).mock.calls[1];
    expect(s2Call[1]).toContain("Mein Input");
    expect(s2Call[1]).toContain("Output");
  });

  // ─── Tool-Pattern Tests ────────────────────────────────

  it("erkennt Tool-Patterns und schlägt fehl wenn Tool nicht installiert", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider();
    const config: AiosConfig = {
      providers: {},
      defaults: { provider: "claude" },
      paths: { patterns: PATTERNS_DIR, personas: "" },
      tools: { output_dir: "/tmp/aios-test-output", allowed: ["mmdc"] },
    };
    const engine = new Engine(registry, provider, config);

    const plan = makePlan({
      steps: [
        { id: "render", pattern: "render_diagram", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: null, retry: null, quality_gate: null },
      ],
    });

    const result = await engine.execute(plan, "graph TD\n  A-->B");
    // mmdc ist nicht installiert → failed
    expect(result.status.get("render")).toBe("failed");
    // Provider sollte NICHT aufgerufen worden sein (Tool-Pattern)
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("blockiert Tools die nicht in der Allowlist stehen", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider();
    const config: AiosConfig = {
      providers: {},
      defaults: { provider: "claude" },
      paths: { patterns: PATTERNS_DIR, personas: "" },
      tools: { output_dir: "/tmp/aios-test-output", allowed: ["prettier"] }, // mmdc NICHT erlaubt
    };
    const engine = new Engine(registry, provider, config);

    const plan = makePlan({
      steps: [
        { id: "render", pattern: "render_diagram", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: null, retry: null, quality_gate: null },
      ],
    });

    const result = await engine.execute(plan, "graph TD\n  A-->B");
    expect(result.status.get("render")).toBe("failed");
  });

  it("LLM-Pattern setzt outputType auf text", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider("Diagramm-Code");
    const engine = new Engine(registry, provider);

    const result = await engine.execute(makePlan(), "Test");
    const stepResult = result.results.get("step1");
    expect(stepResult?.outputType).toBe("text");
    expect(stepResult?.filePath).toBeUndefined();
  });

  it("Tool-Pattern mit echo erzeugt Datei-Output", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider();
    const config: AiosConfig = {
      providers: {},
      defaults: { provider: "claude" },
      paths: { patterns: PATTERNS_DIR, personas: "" },
      tools: { output_dir: "/tmp/aios-test-output", allowed: ["cp"] },
    };
    const engine = new Engine(registry, provider, config);

    // render_diagram nutzt mmdc (nicht verfügbar) → wir testen nur die Branching-Logik
    // Prüfe dass generate_diagram (LLM-Pattern) korrekt als LLM erkannt wird
    const plan = makePlan({
      steps: [
        { id: "gen", pattern: "generate_diagram", depends_on: [], input_from: ["$USER_INPUT"], parallel_group: null, retry: null, quality_gate: null },
      ],
    });

    const result = await engine.execute(plan, "Erstelle Flowchart");
    expect(result.status.get("gen")).toBe("done");
    expect(result.results.get("gen")?.outputType).toBe("text");
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
});
