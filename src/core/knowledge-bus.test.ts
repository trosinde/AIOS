import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KnowledgeBus } from "./knowledge-bus.js";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ExecutionContext } from "../types.js";

describe("KnowledgeBus", () => {
  let bus: KnowledgeBus;
  const dbPath = join(tmpdir(), `aios-bus-test-${Date.now()}.db`);

  const ctxA: ExecutionContext = { trace_id: "trace-aaa", context_id: "context-a", started_at: Date.now() };
  const ctxB: ExecutionContext = { trace_id: "trace-bbb", context_id: "context-b", started_at: Date.now() };

  beforeEach(() => {
    bus = new KnowledgeBus(dbPath);
  });

  afterEach(() => {
    bus.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  });

  // ─── Publish & Query ─────────────────────────────────

  it("publiziert und liest eine Nachricht", () => {
    const id = bus.publish({
      type: "decision",
      tags: ["api"],
      source_pattern: "design_solution",
      content: "REST statt gRPC",
      format: "text",
      target_context: ctxA.context_id,
    }, ctxA);

    expect(id).toBeDefined();

    const results = bus.query({}, ctxA);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("REST statt gRPC");
    expect(results[0].source_context).toBe("context-a");
    expect(results[0].trace_id).toBe("trace-aaa");
  });

  // ─── Context Isolation ───────────────────────────────

  it("isoliert Messages zwischen Contexts", () => {
    bus.publish({
      type: "fact",
      tags: [],
      source_pattern: "s1",
      content: "Context A Fakt",
      format: "text",
      target_context: "context-a",
    }, ctxA);

    bus.publish({
      type: "fact",
      tags: [],
      source_pattern: "s2",
      content: "Context B Fakt",
      format: "text",
      target_context: "context-b",
    }, ctxB);

    // A sieht nur A
    expect(bus.query({}, ctxA)).toHaveLength(1);
    expect(bus.query({}, ctxA)[0].content).toBe("Context A Fakt");

    // B sieht nur B
    expect(bus.query({}, ctxB)).toHaveLength(1);
    expect(bus.query({}, ctxB)[0].content).toBe("Context B Fakt");
  });

  it("Broadcasts sind für alle sichtbar", () => {
    bus.publish({
      type: "fact",
      tags: [],
      source_pattern: "broadcast",
      content: "Globale Nachricht",
      format: "text",
      target_context: "*",
    }, ctxA);

    // Auch Context B sieht den Broadcast
    const resultsB = bus.query({ include_cross_context: true }, ctxB);
    expect(resultsB).toHaveLength(1);
    expect(resultsB[0].content).toBe("Globale Nachricht");
  });

  it("cross-context Query findet gezielte Nachrichten", () => {
    bus.publish({
      type: "requirement",
      tags: ["security"],
      source_pattern: "threat_model",
      content: "Compliance-Finding für Context B",
      format: "text",
      target_context: "context-b",
    }, ctxA);

    // B findet die Nachricht mit cross-context
    const resultsB = bus.query({ include_cross_context: true }, ctxB);
    expect(resultsB).toHaveLength(1);

    // A findet die Nachricht auch (eigener Context)
    const resultsA = bus.query({}, ctxA);
    expect(resultsA).toHaveLength(1);
  });

  // ─── Filter ──────────────────────────────────────────

  it("filtert nach Type", () => {
    bus.publish({ type: "decision", tags: [], source_pattern: "s1", content: "D1", format: "text", target_context: ctxA.context_id }, ctxA);
    bus.publish({ type: "fact", tags: [], source_pattern: "s1", content: "F1", format: "text", target_context: ctxA.context_id }, ctxA);

    expect(bus.query({ type: "decision" }, ctxA)).toHaveLength(1);
    expect(bus.query({ type: "fact" }, ctxA)).toHaveLength(1);
    expect(bus.query({ type: "requirement" }, ctxA)).toHaveLength(0);
  });

  it("filtert nach Tags", () => {
    bus.publish({ type: "fact", tags: ["api", "rest"], source_pattern: "s1", content: "REST API", format: "text", target_context: ctxA.context_id }, ctxA);
    bus.publish({ type: "fact", tags: ["security"], source_pattern: "s1", content: "Auth", format: "text", target_context: ctxA.context_id }, ctxA);

    expect(bus.query({ tags: ["api"] }, ctxA)).toHaveLength(1);
    expect(bus.query({ tags: ["security"] }, ctxA)).toHaveLength(1);
    expect(bus.query({ tags: ["unknown"] }, ctxA)).toHaveLength(0);
  });

  it("filtert nach source_pattern", () => {
    bus.publish({ type: "fact", tags: [], source_pattern: "code_review", content: "Review", format: "text", target_context: ctxA.context_id }, ctxA);
    bus.publish({ type: "fact", tags: [], source_pattern: "security_review", content: "Security", format: "text", target_context: ctxA.context_id }, ctxA);

    expect(bus.query({ source_pattern: "code_review" }, ctxA)).toHaveLength(1);
    expect(bus.query({ source_pattern: "security_review" }, ctxA)).toHaveLength(1);
  });

  it("respektiert limit", () => {
    for (let i = 0; i < 10; i++) {
      bus.publish({ type: "fact", tags: [], source_pattern: "s1", content: `Fakt ${i}`, format: "text", target_context: ctxA.context_id }, ctxA);
    }

    expect(bus.query({ limit: 3 }, ctxA)).toHaveLength(3);
    expect(bus.query({ limit: 100 }, ctxA)).toHaveLength(10);
  });

  // ─── Search ──────────────────────────────────────────

  it("sucht in content", () => {
    bus.publish({ type: "fact", tags: [], source_pattern: "s1", content: "Python 3.12 mit FastAPI", format: "text", target_context: ctxA.context_id }, ctxA);
    bus.publish({ type: "fact", tags: [], source_pattern: "s1", content: "Node.js mit Express", format: "text", target_context: ctxA.context_id }, ctxA);

    const results = bus.search("FastAPI", ctxA);
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("FastAPI");
  });

  // ─── Trace ───────────────────────────────────────────

  it("findet alle Messages eines Trace", () => {
    bus.publish({ type: "fact", tags: [], source_pattern: "s1", content: "Step 1", format: "text", target_context: ctxA.context_id }, ctxA);
    bus.publish({ type: "decision", tags: [], source_pattern: "s2", content: "Step 2", format: "text", target_context: ctxA.context_id }, ctxA);

    const trace = bus.byTrace("trace-aaa");
    expect(trace).toHaveLength(2);
  });

  // ─── Stats & Delete ──────────────────────────────────

  it("liefert Statistiken pro Context", () => {
    bus.publish({ type: "decision", tags: [], source_pattern: "s1", content: "D1", format: "text", target_context: ctxA.context_id }, ctxA);
    bus.publish({ type: "decision", tags: [], source_pattern: "s1", content: "D2", format: "text", target_context: ctxA.context_id }, ctxA);
    bus.publish({ type: "fact", tags: [], source_pattern: "s1", content: "F1", format: "text", target_context: ctxB.context_id }, ctxB);

    const statsA = bus.stats("context-a");
    expect(statsA.decision).toBe(2);
    expect(statsA.fact).toBe(0);

    const statsB = bus.stats("context-b");
    expect(statsB.fact).toBe(1);
  });

  it("löscht eine Nachricht", () => {
    const id = bus.publish({ type: "fact", tags: [], source_pattern: "s1", content: "Temp", format: "text", target_context: ctxA.context_id }, ctxA);
    expect(bus.query({}, ctxA)).toHaveLength(1);

    expect(bus.delete(id)).toBe(true);
    expect(bus.query({}, ctxA)).toHaveLength(0);
  });

  // ─── Metadata ────────────────────────────────────────

  it("speichert und liest Metadata", () => {
    bus.publish({
      type: "artifact",
      tags: ["code"],
      source_pattern: "generate_code",
      content: "function hello() {}",
      format: "json",
      target_context: ctxA.context_id,
      metadata: { language: "typescript", lines: 42 },
    }, ctxA);

    const results = bus.query({}, ctxA);
    expect(results[0].metadata).toEqual({ language: "typescript", lines: 42 });
    expect(results[0].format).toBe("json");
  });
});
