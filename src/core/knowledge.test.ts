import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KnowledgeBase } from "./knowledge.js";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("KnowledgeBase", () => {
  let kb: KnowledgeBase;
  const dbPath = join(tmpdir(), `aios-test-${Date.now()}.db`);

  beforeEach(() => {
    kb = new KnowledgeBase(dbPath);
  });

  afterEach(() => {
    kb.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it("speichert und liest ein Knowledge-Item", () => {
    const item = kb.add({
      type: "decision",
      content: "REST statt gRPC wegen Client-Kompatibilität",
      source: "design_solution",
      tags: ["api", "architecture"],
    });

    expect(item.id).toBeDefined();
    expect(item.type).toBe("decision");

    const all = kb.all();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe("REST statt gRPC wegen Client-Kompatibilität");
    expect(all[0].tags).toEqual(["api", "architecture"]);
  });

  it("filtert nach Typ", () => {
    kb.add({ type: "decision", content: "Decision 1", source: "router", tags: [] });
    kb.add({ type: "fact", content: "Fact 1", source: "router", tags: [] });
    kb.add({ type: "decision", content: "Decision 2", source: "router", tags: [] });

    expect(kb.byType("decision")).toHaveLength(2);
    expect(kb.byType("fact")).toHaveLength(1);
    expect(kb.byType("requirement")).toHaveLength(0);
  });

  it("sucht in content und tags", () => {
    kb.add({ type: "fact", content: "Python 3.12 mit FastAPI", source: "architect", tags: ["python"] });
    kb.add({ type: "fact", content: "Node.js 20 mit Express", source: "architect", tags: ["node"] });

    expect(kb.search("FastAPI")).toHaveLength(1);
    expect(kb.search("python")).toHaveLength(1); // tag match
    expect(kb.search("architect")).toHaveLength(0); // source is not searched
  });

  it("filtert nach Projekt", () => {
    kb.add({ type: "fact", content: "Fakt A", source: "s1", tags: [], project: "alpha" });
    kb.add({ type: "fact", content: "Fakt B", source: "s1", tags: [], project: "beta" });

    expect(kb.all("alpha")).toHaveLength(1);
    expect(kb.all("beta")).toHaveLength(1);
    expect(kb.all()).toHaveLength(2);
  });

  it("liefert Statistiken", () => {
    kb.add({ type: "decision", content: "D1", source: "s1", tags: [] });
    kb.add({ type: "decision", content: "D2", source: "s1", tags: [] });
    kb.add({ type: "fact", content: "F1", source: "s1", tags: [] });

    const stats = kb.stats();
    expect(stats.decision).toBe(2);
    expect(stats.fact).toBe(1);
    expect(stats.requirement).toBe(0);
  });

  it("löscht ein Item", () => {
    const item = kb.add({ type: "fact", content: "temp", source: "s1", tags: [] });
    expect(kb.all()).toHaveLength(1);

    const deleted = kb.delete(item.id);
    expect(deleted).toBe(true);
    expect(kb.all()).toHaveLength(0);
  });
});
