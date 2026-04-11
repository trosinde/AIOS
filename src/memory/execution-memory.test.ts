import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, existsSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ExecutionMemory } from "./execution-memory.js";
import type { ExecutionRecord } from "../types.js";

function makeRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    timestamp: new Date().toISOString(),
    pattern: "summarize",
    provider: "ollama-qwen",
    model: "qwen3:235b",
    costTier: 1,
    outcome: "success",
    attempt: 1,
    durationMs: 500,
    tokensInput: 100,
    tokensOutput: 50,
    ...overrides,
  };
}

describe("ExecutionMemory", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aios-mem-"));
    filePath = join(dir, "memory.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("empty memory returns empty stats", () => {
    const mem = new ExecutionMemory(filePath);
    expect(mem.getStats("summarize")).toEqual([]);
    expect(mem.allStats()).toEqual([]);
    expect(mem.recordCount()).toBe(0);
  });

  it("logs records and returns aggregated stats", () => {
    const mem = new ExecutionMemory(filePath);
    mem.log(makeRecord({ outcome: "success" }));
    mem.log(makeRecord({ outcome: "success" }));
    mem.log(makeRecord({ outcome: "failed" }));

    const stats = mem.getStats("summarize");
    expect(stats).toHaveLength(1);
    expect(stats[0].provider).toBe("ollama-qwen");
    expect(stats[0].totalRuns).toBe(3);
    expect(stats[0].successRate).toBeCloseTo(66.7, 1);
  });

  it("only counts first attempts for statistics", () => {
    const mem = new ExecutionMemory(filePath);
    mem.log(makeRecord({ attempt: 1, outcome: "success" }));
    mem.log(makeRecord({ attempt: 2, outcome: "success" })); // retry – ignored in stats
    mem.log(makeRecord({ attempt: 3, outcome: "success" })); // retry – ignored in stats

    const stats = mem.getStats("summarize");
    expect(stats[0].totalRuns).toBe(1);
    expect(stats[0].successRate).toBe(100);
  });

  it("groups stats by provider", () => {
    const mem = new ExecutionMemory(filePath);
    mem.log(makeRecord({ provider: "a", outcome: "success" }));
    mem.log(makeRecord({ provider: "b", outcome: "failed" }));
    mem.log(makeRecord({ provider: "b", outcome: "success" }));

    const stats = mem.getStats("summarize");
    expect(stats).toHaveLength(2);
    const a = stats.find((s) => s.provider === "a")!;
    const b = stats.find((s) => s.provider === "b")!;
    expect(a.successRate).toBe(100);
    expect(b.successRate).toBe(50);
  });

  it("persists to disk and reloads", () => {
    const mem1 = new ExecutionMemory(filePath);
    mem1.log(makeRecord());
    expect(existsSync(filePath)).toBe(true);

    const mem2 = new ExecutionMemory(filePath);
    expect(mem2.recordCount()).toBe(1);
  });

  it("handles corrupt file without crashing", () => {
    writeFileSync(filePath, "{{not valid json", "utf-8");
    const mem = new ExecutionMemory(filePath);
    expect(mem.recordCount()).toBe(0);
    // Can still log
    mem.log(makeRecord());
    expect(mem.recordCount()).toBe(1);
  });

  it("reset() without filter clears everything", () => {
    const mem = new ExecutionMemory(filePath);
    mem.log(makeRecord());
    mem.log(makeRecord());
    const deleted = mem.reset();
    expect(deleted).toBe(2);
    expect(mem.recordCount()).toBe(0);
  });

  it("reset() with pattern filter only clears that pattern", () => {
    const mem = new ExecutionMemory(filePath);
    mem.log(makeRecord({ pattern: "summarize" }));
    mem.log(makeRecord({ pattern: "code_review" }));
    mem.reset({ pattern: "summarize" });
    expect(mem.recordCount()).toBe(1);
    expect(mem.getStats("code_review")).toHaveLength(1);
  });

  it("reset() with provider filter only clears that provider", () => {
    const mem = new ExecutionMemory(filePath);
    mem.log(makeRecord({ provider: "a" }));
    mem.log(makeRecord({ provider: "b" }));
    mem.reset({ provider: "a" });
    expect(mem.recordCount()).toBe(1);
  });

  it("reset() with both filters only clears that combination", () => {
    const mem = new ExecutionMemory(filePath);
    mem.log(makeRecord({ pattern: "summarize", provider: "a" }));
    mem.log(makeRecord({ pattern: "summarize", provider: "b" }));
    mem.log(makeRecord({ pattern: "code_review", provider: "a" }));
    mem.reset({ pattern: "summarize", provider: "a" });
    expect(mem.recordCount()).toBe(2);
  });

  it("getProviderReliability returns -1 when no data", () => {
    const mem = new ExecutionMemory(filePath);
    expect(mem.getProviderReliability("unknown")).toBe(-1);
  });

  it("getProviderReliability computes global rate across patterns", () => {
    const mem = new ExecutionMemory(filePath);
    mem.log(makeRecord({ pattern: "p1", outcome: "success" }));
    mem.log(makeRecord({ pattern: "p2", outcome: "success" }));
    mem.log(makeRecord({ pattern: "p3", outcome: "failed" }));
    expect(mem.getProviderReliability("ollama-qwen")).toBeCloseTo(66.7, 1);
  });

  it("allStats aggregates across all patterns", () => {
    const mem = new ExecutionMemory(filePath);
    mem.log(makeRecord({ pattern: "summarize" }));
    mem.log(makeRecord({ pattern: "code_review" }));
    const all = mem.allStats();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.pattern).sort()).toEqual(["code_review", "summarize"]);
  });
});
