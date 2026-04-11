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

  it("persists to disk and reloads", async () => {
    const mem1 = new ExecutionMemory(filePath);
    mem1.log(makeRecord());
    await mem1.flush();
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

  it("stamps records with the memory's contextId", async () => {
    const mem = new ExecutionMemory(filePath, "ctx-alpha");
    mem.log(makeRecord({ contextId: "wrong" }));
    await mem.flush();
    // Re-load raw JSON and confirm contextId was stamped correctly.
    const raw = JSON.parse(require("fs").readFileSync(filePath, "utf-8"));
    expect(raw.records[0].contextId).toBe("ctx-alpha");
  });

  it("isolates stats between contexts", () => {
    const memA = new ExecutionMemory(filePath, "ctx-a");
    memA.log(makeRecord({ pattern: "p1", outcome: "success" }));
    memA.log(makeRecord({ pattern: "p1", outcome: "failed" }));

    // Same file, different context — must NOT see ctx-a's data in its stats.
    const memB = new ExecutionMemory(filePath, "ctx-b");
    expect(memB.getStats("p1")).toHaveLength(0);
    expect(memB.getProviderReliability("ollama-qwen")).toBe(-1);

    // But ctx-a still sees its own.
    expect(memA.getStats("p1")).toHaveLength(1);
  });

  it("serializes concurrent log() calls without data loss", async () => {
    const mem = new ExecutionMemory(filePath);
    // Fire 50 parallel logs — mimics Promise.all in the Engine.
    const promises = Array.from({ length: 50 }, (_, i) =>
      Promise.resolve().then(() => mem.log(makeRecord({ stepId: `s${i}` }))),
    );
    await Promise.all(promises);
    await mem.flush();

    // Fresh load sees all 50 records.
    const fresh = new ExecutionMemory(filePath);
    expect(fresh.recordCount()).toBe(50);
  });

  it("caps memory at maxRecords via FIFO rotation", () => {
    // Use a small cap for test speed.
    const mem = new ExecutionMemory(filePath, "default", { maxRecords: 10 });
    for (let i = 0; i < 15; i++) {
      mem.log(makeRecord({ stepId: `s${i}` }));
    }
    expect(mem.recordCount()).toBe(10);
  });

  it("drops malformed records on load without crashing", () => {
    // Write a file with one valid + one malformed record.
    const goodRecord = makeRecord();
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        records: [goodRecord, { foo: "bar" }, { pattern: "missing-fields" }],
      }),
      "utf-8",
    );
    const mem = new ExecutionMemory(filePath);
    expect(mem.recordCount()).toBe(1);
  });
});
