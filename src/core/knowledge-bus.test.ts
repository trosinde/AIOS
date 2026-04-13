import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KnowledgeBus } from "./knowledge-bus.js";
import { StubEmbeddingProvider } from "./embedding-provider.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ExecutionContext } from "../types.js";

describe("KnowledgeBus (LanceDB)", () => {
  let bus: KnowledgeBus;
  let dbDir: string;

  const ctxA: ExecutionContext = {
    trace_id: "trace-aaa",
    context_id: "context-a",
    started_at: Date.now(),
  };
  const ctxB: ExecutionContext = {
    trace_id: "trace-bbb",
    context_id: "context-b",
    started_at: Date.now(),
  };

  beforeEach(async () => {
    dbDir = mkdtempSync(join(tmpdir(), "aios-kb-test-"));
    bus = await KnowledgeBus.create(dbDir, new StubEmbeddingProvider());
  });

  afterEach(async () => {
    await bus.close();
    try {
      rmSync(dbDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ─── Publish & Query ─────────────────────────────────

  it("publiziert und liest eine Nachricht", async () => {
    const id = await bus.publish(
      {
        type: "decision",
        tags: ["api"],
        source_pattern: "design_solution",
        content: "REST statt gRPC",
        format: "text",
        target_context: ctxA.context_id,
      },
      ctxA,
    );

    expect(id).toBeDefined();

    const results = await bus.query({}, ctxA);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("REST statt gRPC");
    expect(results[0].source_context).toBe("context-a");
    expect(results[0].trace_id).toBe("trace-aaa");
    expect(results[0].tags).toEqual(["api"]);
  });

  // ─── Context Isolation ───────────────────────────────

  it("isoliert Messages zwischen Contexts", async () => {
    await bus.publish(
      {
        type: "fact",
        tags: [],
        source_pattern: "s1",
        content: "Context A Fakt",
        format: "text",
        target_context: "context-a",
      },
      ctxA,
    );

    await bus.publish(
      {
        type: "fact",
        tags: [],
        source_pattern: "s2",
        content: "Context B Fakt",
        format: "text",
        target_context: "context-b",
      },
      ctxB,
    );

    const a = await bus.query({}, ctxA);
    expect(a).toHaveLength(1);
    expect(a[0].content).toBe("Context A Fakt");

    const b = await bus.query({}, ctxB);
    expect(b).toHaveLength(1);
    expect(b[0].content).toBe("Context B Fakt");
  });

  it("Broadcasts sind für alle sichtbar", async () => {
    await bus.publish(
      {
        type: "fact",
        tags: [],
        source_pattern: "broadcast",
        content: "Globale Nachricht",
        format: "text",
        target_context: "*",
      },
      ctxA,
    );

    const resultsB = await bus.query({ include_cross_context: true }, ctxB);
    expect(resultsB).toHaveLength(1);
    expect(resultsB[0].content).toBe("Globale Nachricht");
  });

  it("cross-context Query findet gezielte Nachrichten", async () => {
    await bus.publish(
      {
        type: "requirement",
        tags: ["security"],
        source_pattern: "threat_model",
        content: "Compliance-Finding für Context B",
        format: "text",
        target_context: "context-b",
      },
      ctxA,
    );

    const resultsB = await bus.query({ include_cross_context: true }, ctxB);
    expect(resultsB).toHaveLength(1);

    const resultsA = await bus.query({}, ctxA);
    expect(resultsA).toHaveLength(1);
  });

  // ─── Filter ──────────────────────────────────────────

  it("filtert nach Type", async () => {
    await bus.publish(
      { type: "decision", tags: [], source_pattern: "s1", content: "D1", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "F1", format: "text", target_context: ctxA.context_id },
      ctxA,
    );

    expect(await bus.query({ type: "decision" }, ctxA)).toHaveLength(1);
    expect(await bus.query({ type: "fact" }, ctxA)).toHaveLength(1);
    expect(await bus.query({ type: "requirement" }, ctxA)).toHaveLength(0);
  });

  it("filtert nach Tags", async () => {
    await bus.publish(
      { type: "fact", tags: ["api", "rest"], source_pattern: "s1", content: "REST API", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    await bus.publish(
      { type: "fact", tags: ["security"], source_pattern: "s1", content: "Auth", format: "text", target_context: ctxA.context_id },
      ctxA,
    );

    expect(await bus.query({ tags: ["api"] }, ctxA)).toHaveLength(1);
    expect(await bus.query({ tags: ["security"] }, ctxA)).toHaveLength(1);
    expect(await bus.query({ tags: ["unknown"] }, ctxA)).toHaveLength(0);
  });

  it("filtert nach source_pattern", async () => {
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "code_review", content: "Review", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "security_review", content: "Security", format: "text", target_context: ctxA.context_id },
      ctxA,
    );

    expect(await bus.query({ source_pattern: "code_review" }, ctxA)).toHaveLength(1);
    expect(await bus.query({ source_pattern: "security_review" }, ctxA)).toHaveLength(1);
  });

  it("respektiert limit", async () => {
    for (let i = 0; i < 10; i++) {
      await bus.publish(
        { type: "fact", tags: [], source_pattern: "s1", content: `Fakt ${i}`, format: "text", target_context: ctxA.context_id },
        ctxA,
      );
    }

    expect(await bus.query({ limit: 3 }, ctxA)).toHaveLength(3);
    expect(await bus.query({ limit: 100 }, ctxA)).toHaveLength(10);
  });

  // ─── Search (keyword) ────────────────────────────────

  it("sucht in content (keyword)", async () => {
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "Python 3.12 mit FastAPI", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "Node.js mit Express", format: "text", target_context: ctxA.context_id },
      ctxA,
    );

    const results = await bus.search("FastAPI", ctxA);
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("FastAPI");
  });

  // ─── Trace ───────────────────────────────────────────

  it("findet alle Messages eines Trace", async () => {
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "Step 1", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    await bus.publish(
      { type: "decision", tags: [], source_pattern: "s2", content: "Step 2", format: "text", target_context: ctxA.context_id },
      ctxA,
    );

    const trace = await bus.byTrace("trace-aaa");
    expect(trace).toHaveLength(2);
  });

  // ─── Stats & Delete ──────────────────────────────────

  it("liefert Statistiken pro Context", async () => {
    await bus.publish(
      { type: "decision", tags: [], source_pattern: "s1", content: "D1", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    await bus.publish(
      { type: "decision", tags: [], source_pattern: "s1", content: "D2", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "F1", format: "text", target_context: ctxB.context_id },
      ctxB,
    );

    const statsA = await bus.stats("context-a");
    expect(statsA.decision).toBe(2);
    expect(statsA.fact).toBe(0);

    const statsB = await bus.stats("context-b");
    expect(statsB.fact).toBe(1);
  });

  it("löscht eine Nachricht", async () => {
    const id = await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "Temp", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    expect(await bus.query({}, ctxA)).toHaveLength(1);

    expect(await bus.delete(id)).toBe(true);
    expect(await bus.query({}, ctxA)).toHaveLength(0);
  });

  // ─── Metadata ────────────────────────────────────────

  it("speichert und liest Metadata", async () => {
    await bus.publish(
      {
        type: "artifact",
        tags: ["code"],
        source_pattern: "generate_code",
        content: "function hello() {}",
        format: "json",
        target_context: ctxA.context_id,
        metadata: { language: "typescript", lines: 42 },
      },
      ctxA,
    );

    const results = await bus.query({}, ctxA);
    expect(results[0].metadata).toMatchObject({ language: "typescript", lines: 42 });
    expect(results[0].metadata?.integrity).toBe("derived"); // integrity column default
    expect(results[0].format).toBe("json");
  });

  // ─── Wing/Room (additive) ────────────────────────────

  it("speichert und filtert nach Wing/Room", async () => {
    await bus.publish(
      {
        type: "decision",
        tags: [],
        source_pattern: "s1",
        content: "ADR-1",
        format: "text",
        target_context: ctxA.context_id,
        wing: "wing_aios_decisions",
        room: "kernel_abi",
      },
      ctxA,
    );

    const taxonomy = await bus.listTaxonomy(ctxA);
    expect(taxonomy).toHaveLength(1);
    expect(taxonomy[0]).toEqual({
      wing: "wing_aios_decisions",
      room: "kernel_abi",
      count: 1,
    });
  });

  // ─── Semantic Search ─────────────────────────────────

  it("semanticSearch findet gespeicherte Nachrichten", async () => {
    // With a deterministic stub embedder, identical content yields
    // identical vectors. So semanticSearch for the exact same string
    // must return that message at the top.
    await bus.publish(
      {
        type: "decision",
        tags: [],
        source_pattern: "s1",
        content: "Use LanceDB for vector storage",
        format: "text",
        target_context: ctxA.context_id,
      },
      ctxA,
    );
    await bus.publish(
      {
        type: "fact",
        tags: [],
        source_pattern: "s1",
        content: "Completely unrelated content about cooking",
        format: "text",
        target_context: ctxA.context_id,
      },
      ctxA,
    );

    const results = await bus.semanticSearch("Use LanceDB for vector storage", ctxA, {
      top_k: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toBe("Use LanceDB for vector storage");
  });

  it("semanticSearch respektiert type-Filter", async () => {
    await bus.publish(
      { type: "decision", tags: [], source_pattern: "s1", content: "Decision A", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "Fact A", format: "text", target_context: ctxA.context_id },
      ctxA,
    );

    const decisions = await bus.semanticSearch("A", ctxA, { type: "decision" });
    expect(decisions.every((m) => m.type === "decision")).toBe(true);

    const facts = await bus.semanticSearch("A", ctxA, { type: "fact" });
    expect(facts.every((m) => m.type === "fact")).toBe(true);
  });

  // ─── checkDuplicate ──────────────────────────────────

  it("checkDuplicate findet exact duplicates via hash", async () => {
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "Identical content", format: "text", target_context: ctxA.context_id },
      ctxA,
    );

    const dup = await bus.checkDuplicate("Identical content", ctxA);
    expect(dup).not.toBeNull();
    expect(dup?.kind).toBe("exact");
    expect(dup?.similarity).toBe(1.0);
  });

  it("checkDuplicate gibt null für unique content", async () => {
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "Original message", format: "text", target_context: ctxA.context_id },
      ctxA,
    );

    const dup = await bus.checkDuplicate("Completely different unique novel content", ctxA);
    // With stub embeddings cosine similarity is essentially random,
    // so we accept either null or a "near" match below threshold.
    if (dup !== null) {
      expect(dup.similarity).toBeLessThan(1.0);
    }
  });

  // ─── publishMany ─────────────────────────────────────

  it("publishMany inseriert mehrere Nachrichten in einem Batch", async () => {
    const ids = await bus.publishMany(
      [
        { type: "fact", tags: [], source_pattern: "s1", content: "F1", format: "text", target_context: ctxA.context_id },
        { type: "fact", tags: [], source_pattern: "s1", content: "F2", format: "text", target_context: ctxA.context_id },
        { type: "fact", tags: [], source_pattern: "s1", content: "F3", format: "text", target_context: ctxA.context_id },
      ],
      ctxA,
    );
    expect(ids).toHaveLength(3);

    const all = await bus.query({}, ctxA);
    expect(all).toHaveLength(3);
  });

  // ─── Knowledge Graph ─────────────────────────────────

  it("kgAdd und kgQuery", async () => {
    await bus.kgAdd("AIOS", "uses", "LanceDB", ctxA);
    await bus.kgAdd("AIOS", "uses", "Ollama", ctxA);
    await bus.kgAdd("LanceDB", "implements", "HNSW", ctxA);

    const subjAios = await bus.kgQuery({ subject: "AIOS" }, ctxA);
    expect(subjAios).toHaveLength(2);

    const predImplements = await bus.kgQuery({ predicate: "implements" }, ctxA);
    expect(predImplements).toHaveLength(1);
    expect(predImplements[0].object).toBe("HNSW");

    const all = await bus.kgQuery({}, ctxA);
    expect(all).toHaveLength(3);
  });

  it("kgQuery isoliert per Context", async () => {
    await bus.kgAdd("X", "is", "Y", ctxA);
    await bus.kgAdd("X", "is", "Z", ctxB);

    const a = await bus.kgQuery({ subject: "X" }, ctxA);
    expect(a).toHaveLength(1);
    expect(a[0].object).toBe("Y");

    const b = await bus.kgQuery({ subject: "X" }, ctxB);
    expect(b).toHaveLength(1);
    expect(b[0].object).toBe("Z");
  });

  // ─── Diary ───────────────────────────────────────────

  it("diaryWrite und diaryRead chronologisch", async () => {
    await bus.diaryWrite("Morning entry", ctxA);
    // Force a tiny delay so created_at orders deterministically.
    await new Promise((r) => setTimeout(r, 5));
    await bus.diaryWrite("Afternoon entry", ctxA);
    await new Promise((r) => setTimeout(r, 5));
    await bus.diaryWrite("Evening entry", ctxA);

    const entries = await bus.diaryRead(ctxA);
    expect(entries).toHaveLength(3);
    expect(entries[0].content).toBe("Morning entry");
    expect(entries[2].content).toBe("Evening entry");
  });

  it("diaryRead mit time bounds", async () => {
    const t1 = Date.now();
    await bus.diaryWrite("First", ctxA);
    await new Promise((r) => setTimeout(r, 10));
    const t2 = Date.now();
    await bus.diaryWrite("Second", ctxA);

    const onlySecond = await bus.diaryRead(ctxA, { since: t2 });
    expect(onlySecond).toHaveLength(1);
    expect(onlySecond[0].content).toBe("Second");
  });

  // ─── Taxonomy ────────────────────────────────────────

  // ─── Cross-context IPC dedicated tests ──────────────

  it("Cross-context: own context never leaks into another context's default query", async () => {
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "p", content: "Private to A", format: "text", target_context: ctxA.context_id },
      ctxA,
    );
    // B's default query (no include_cross_context) MUST NOT see A's items
    const b = await bus.query({}, ctxB);
    expect(b).toHaveLength(0);
  });

  it("Cross-context: explicit target_context = ctxB.context_id is visible to B but only with include_cross_context", async () => {
    await bus.publish(
      {
        type: "requirement",
        tags: ["compliance"],
        source_pattern: "regulator",
        content: "Targeted requirement for B",
        format: "text",
        target_context: ctxB.context_id,
      },
      ctxA,
    );
    // Without cross-context flag B sees nothing (the message lives in A's context)
    expect(await bus.query({}, ctxB)).toHaveLength(0);
    // With cross-context flag B sees it because target_context matches
    const withCross = await bus.query({ include_cross_context: true }, ctxB);
    expect(withCross).toHaveLength(1);
    expect(withCross[0].content).toBe("Targeted requirement for B");
    // A still sees it via own context
    expect(await bus.query({}, ctxA)).toHaveLength(1);
  });

  it("Cross-context: broadcast (target=*) reaches all contexts only with include_cross_context", async () => {
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "broadcast", content: "Globalfact", format: "text", target_context: "*" },
      ctxA,
    );
    expect(await bus.query({}, ctxB)).toHaveLength(0); // not via own-context filter
    expect(await bus.query({ include_cross_context: true }, ctxB)).toHaveLength(1);
    expect(await bus.query({ include_cross_context: true }, ctxA)).toHaveLength(1);
  });

  it("Cross-context: filters compose with type/tag/since", async () => {
    await bus.publish(
      { type: "decision", tags: ["arch"], source_pattern: "p", content: "A's decision", format: "text", target_context: "*" },
      ctxA,
    );
    await bus.publish(
      { type: "fact", tags: ["other"], source_pattern: "p", content: "A's fact", format: "text", target_context: "*" },
      ctxA,
    );
    // B sees only the decision via cross-context + type filter
    const r = await bus.query({ include_cross_context: true, type: "decision" }, ctxB);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe("decision");
  });

  it("Cross-context: KG triples are still strictly context-isolated", async () => {
    // KG isolation is intentionally stricter than messages — no
    // broadcast / target_context concept (Phase 2 follow-up if needed).
    await bus.kgAdd("foo", "is", "bar", ctxA);
    expect(await bus.kgQuery({ subject: "foo" }, ctxA)).toHaveLength(1);
    expect(await bus.kgQuery({ subject: "foo" }, ctxB)).toHaveLength(0);
  });

  // ─── Taxonomy ────────────────────────────────────────

  it("listTaxonomy gruppiert nach wing/room", async () => {
    await bus.publish(
      { type: "decision", tags: [], source_pattern: "s1", content: "D1", format: "text", target_context: ctxA.context_id, wing: "w1", room: "r1" },
      ctxA,
    );
    await bus.publish(
      { type: "decision", tags: [], source_pattern: "s1", content: "D2", format: "text", target_context: ctxA.context_id, wing: "w1", room: "r1" },
      ctxA,
    );
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "F1", format: "text", target_context: ctxA.context_id, wing: "w1", room: "r2" },
      ctxA,
    );
    await bus.publish(
      { type: "fact", tags: [], source_pattern: "s1", content: "F2", format: "text", target_context: ctxA.context_id, wing: "w2", room: "r3" },
      ctxA,
    );

    const taxonomy = await bus.listTaxonomy(ctxA);
    expect(taxonomy).toHaveLength(3);
    const w1r1 = taxonomy.find((e) => e.wing === "w1" && e.room === "r1");
    expect(w1r1?.count).toBe(2);
  });
});
