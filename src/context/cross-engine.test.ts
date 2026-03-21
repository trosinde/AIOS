import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { topoSort, validateCrossContextPlan } from "./cross-engine.js";
import type { CrossContextPlan, ContextManifest } from "../types.js";

// ─── topoSort ─────────────────────────────────────────

describe("topoSort", () => {
  it("sortiert lineare Kette korrekt", () => {
    const steps: CrossContextPlan["plan"]["steps"] = [
      { id: "c", context: "ctx", task: "c", depends_on: ["b"], input_from: [], output_type: "text" },
      { id: "a", context: "ctx", task: "a", depends_on: [], input_from: [], output_type: "text" },
      { id: "b", context: "ctx", task: "b", depends_on: ["a"], input_from: [], output_type: "text" },
    ];
    const sorted = topoSort(steps);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("sortiert parallele Steps (ohne Dependencies)", () => {
    const steps: CrossContextPlan["plan"]["steps"] = [
      { id: "a", context: "ctx", task: "a", depends_on: [], input_from: [], output_type: "text" },
      { id: "b", context: "ctx", task: "b", depends_on: [], input_from: [], output_type: "text" },
    ];
    const sorted = topoSort(steps);
    expect(sorted).toHaveLength(2);
    // Both are valid orders since no dependencies
    expect(sorted.map((s) => s.id)).toContain("a");
    expect(sorted.map((s) => s.id)).toContain("b");
  });

  it("erkennt zyklische Abhängigkeiten", () => {
    const steps: CrossContextPlan["plan"]["steps"] = [
      { id: "a", context: "ctx", task: "a", depends_on: ["b"], input_from: [], output_type: "text" },
      { id: "b", context: "ctx", task: "b", depends_on: ["a"], input_from: [], output_type: "text" },
    ];
    expect(() => topoSort(steps)).toThrow("Zyklische Abhängigkeit");
  });

  it("wirft bei fehlender Step-Referenz", () => {
    const steps: CrossContextPlan["plan"]["steps"] = [
      { id: "a", context: "ctx", task: "a", depends_on: ["missing"], input_from: [], output_type: "text" },
    ];
    expect(() => topoSort(steps)).toThrow('Step "missing" nicht gefunden');
  });

  it("behandelt leere Step-Liste", () => {
    const sorted = topoSort([]);
    expect(sorted).toEqual([]);
  });

  it("sortiert DAG mit Diamond-Dependency", () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    const steps: CrossContextPlan["plan"]["steps"] = [
      { id: "d", context: "ctx", task: "d", depends_on: ["b", "c"], input_from: [], output_type: "text" },
      { id: "b", context: "ctx", task: "b", depends_on: ["a"], input_from: [], output_type: "text" },
      { id: "c", context: "ctx", task: "c", depends_on: ["a"], input_from: [], output_type: "text" },
      { id: "a", context: "ctx", task: "a", depends_on: [], input_from: [], output_type: "text" },
    ];
    const sorted = topoSort(steps);
    const ids = sorted.map((s) => s.id);
    // a must come first, d must come last
    expect(ids[0]).toBe("a");
    expect(ids[ids.length - 1]).toBe("d");
  });
});

// ─── validateCrossContextPlan ──────────────────────────

describe("validateCrossContextPlan", () => {
  it("akzeptiert validen Plan", () => {
    const plan = {
      analysis: { goal: "test", contexts_needed: ["a"], single_context: false },
      plan: {
        type: "pipe",
        steps: [{ id: "s1", context: "a", task: "do stuff", depends_on: [], input_from: ["$USER_INPUT"], output_type: "text" }],
      },
      reasoning: "test",
    };
    expect(() => validateCrossContextPlan(plan)).not.toThrow();
  });

  it("wirft bei null/undefined", () => {
    expect(() => validateCrossContextPlan(null)).toThrow("kein gültiges Objekt");
    expect(() => validateCrossContextPlan(undefined)).toThrow("kein gültiges Objekt");
  });

  it("wirft bei fehlendem analysis", () => {
    expect(() => validateCrossContextPlan({ plan: { type: "pipe", steps: [{ id: "a", context: "c", task: "t" }] } }))
      .toThrow("analysis");
  });

  it("wirft bei fehlendem plan", () => {
    expect(() => validateCrossContextPlan({ analysis: { goal: "test" } }))
      .toThrow("plan");
  });

  it("wirft bei ungültigem plan.type", () => {
    expect(() => validateCrossContextPlan({
      analysis: { goal: "test" },
      plan: { type: "invalid", steps: [{ id: "a", context: "c", task: "t" }] },
    })).toThrow("plan.type");
  });

  it("wirft bei leeren Steps", () => {
    expect(() => validateCrossContextPlan({
      analysis: { goal: "test" },
      plan: { type: "pipe", steps: [] },
    })).toThrow("steps");
  });

  it("wirft bei Step ohne id", () => {
    expect(() => validateCrossContextPlan({
      analysis: { goal: "test" },
      plan: { type: "pipe", steps: [{ context: "c", task: "t" }] },
    })).toThrow("'id'");
  });

  it("wirft bei Step ohne context", () => {
    expect(() => validateCrossContextPlan({
      analysis: { goal: "test" },
      plan: { type: "pipe", steps: [{ id: "s1", task: "t" }] },
    })).toThrow("'context'");
  });

  it("wirft bei Step ohne task", () => {
    expect(() => validateCrossContextPlan({
      analysis: { goal: "test" },
      plan: { type: "pipe", steps: [{ id: "s1", context: "c" }] },
    })).toThrow("'task'");
  });

  it("setzt fehlende depends_on und input_from als Defaults", () => {
    const plan = {
      analysis: { goal: "test" },
      plan: { type: "dag", steps: [{ id: "s1", context: "c", task: "t" }] },
    };
    validateCrossContextPlan(plan);
    // After validation, defaults should be set
    expect((plan as CrossContextPlan).plan.steps[0].depends_on).toEqual([]);
    expect((plan as CrossContextPlan).plan.steps[0].input_from).toEqual(["$USER_INPUT"]);
  });
});

// ─── CrossContextEngine.execute ─────────────────────────

describe("CrossContextEngine", () => {
  let tmpDir: string;
  let mockHome: string;

  beforeEach(() => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    tmpDir = join(tmpdir(), `aios-cross-test-${id}`);
    mockHome = join(tmpdir(), `aios-cross-home-${id}`);
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(mockHome, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(mockHome, { recursive: true, force: true }); } catch { /* ignore */ }
    vi.restoreAllMocks();
  });

  it("markiert Steps als failed wenn Kontext nicht in Registry", async () => {
    // Mock registry to return empty
    vi.doMock("./registry.js", () => ({
      readRegistry: () => ({ contexts: [] }),
    }));

    const { CrossContextEngine } = await import("./cross-engine.js");
    const engine = new CrossContextEngine();

    const plan: CrossContextPlan = {
      analysis: { goal: "test", contexts_needed: ["missing"], single_context: true },
      plan: {
        type: "pipe",
        steps: [{ id: "s1", context: "missing", task: "do stuff", depends_on: [], input_from: ["$USER_INPUT"], output_type: "text" }],
      },
      reasoning: "test",
    };

    const result = await engine.execute(plan, "input");
    expect(result.status.get("s1")).toBe("failed");
    expect(result.results.get("s1")?.output).toContain("FEHLER");
  });

  it("überspringt abhängige Steps bei Fehler", async () => {
    // Mock registry to return empty (will cause step failure)
    vi.doMock("./registry.js", () => ({
      readRegistry: () => ({ contexts: [] }),
    }));

    const { CrossContextEngine } = await import("./cross-engine.js");
    const engine = new CrossContextEngine();

    const plan: CrossContextPlan = {
      analysis: { goal: "test", contexts_needed: ["a"], single_context: false },
      plan: {
        type: "pipe",
        steps: [
          { id: "s1", context: "missing", task: "first", depends_on: [], input_from: ["$USER_INPUT"], output_type: "text" },
          { id: "s2", context: "missing", task: "second", depends_on: ["s1"], input_from: ["s1"], output_type: "text" },
        ],
      },
      reasoning: "test",
    };

    const result = await engine.execute(plan, "input");
    expect(result.status.get("s1")).toBe("failed");
    expect(result.status.get("s2")).toBe("failed");
    expect(result.results.get("s2")?.output).toContain("ÜBERSPRUNGEN");
  });
});
