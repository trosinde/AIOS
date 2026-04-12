import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";

describe("knowledge-migrate", () => {
  let testDir: string;
  let aiosHome: string;
  const origHome = process.env.HOME;
  const origEmbedding = process.env.AIOS_EMBEDDING_PROVIDER;

  beforeEach(() => {
    testDir = join(tmpdir(), `aios-migrate-test-${randomUUID()}`);
    aiosHome = join(testDir, ".aios");
    mkdirSync(join(aiosHome, "knowledge"), { recursive: true });
    process.env.HOME = testDir;
    process.env.AIOS_EMBEDDING_PROVIDER = "stub";
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (origEmbedding !== undefined) {
      process.env.AIOS_EMBEDDING_PROVIDER = origEmbedding;
    } else {
      delete process.env.AIOS_EMBEDDING_PROVIDER;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  function createLegacyBusDb(rows: Array<{
    type: string;
    content: string;
    source_context?: string;
    source_pattern?: string;
    tags?: string[];
  }>): string {
    const dbPath = join(aiosHome, "knowledge", "bus.db.pre-lance.bak");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        source_context TEXT NOT NULL,
        target_context TEXT NOT NULL DEFAULT '*',
        created_at INTEGER NOT NULL,
        type TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source_pattern TEXT NOT NULL,
        source_step TEXT,
        content TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'text',
        metadata TEXT
      )
    `);
    const stmt = db.prepare(
      "INSERT INTO messages (id, trace_id, source_context, target_context, created_at, type, tags, source_pattern, content, format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const r of rows) {
      stmt.run(
        randomUUID(),
        randomUUID(),
        r.source_context ?? "default",
        "*",
        Date.now(),
        r.type,
        JSON.stringify(r.tags ?? []),
        r.source_pattern ?? "test",
        r.content,
        "text",
      );
    }
    db.close();
    return dbPath;
  }

  function createLegacyKnowledgeDb(rows: Array<{
    type: string;
    content: string;
    source?: string;
    project?: string;
  }>): string {
    const dbPath = join(aiosHome, "knowledge.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE knowledge (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        project TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const stmt = db.prepare(
      "INSERT INTO knowledge (id, type, content, source, tags, project) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const r of rows) {
      stmt.run(randomUUID(), r.type, r.content, r.source ?? "", "[]", r.project ?? null);
    }
    db.close();
    return dbPath;
  }

  it("should migrate legacy bus.db rows to LanceDB", async () => {
    createLegacyBusDb([
      { type: "decision", content: "We chose LanceDB over ChromaDB" },
      { type: "fact", content: "LanceDB supports HNSW indexing" },
      { type: "requirement", content: "Must support offline operation" },
    ]);

    const { runKnowledgeMigrate } = await import("./knowledge-migrate.js");
    await runKnowledgeMigrate({ context: "default" });

    const { KnowledgeBus } = await import("../core/knowledge-bus.js");
    const bus = await KnowledgeBus.create(join(aiosHome, "knowledge"));
    const ctx = { trace_id: randomUUID(), context_id: "default", started_at: Date.now() };
    const results = await bus.search("LanceDB", ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.content.includes("chose LanceDB"))).toBe(true);
    await bus.close();
  });

  it("should skip duplicates on second run (idempotent)", async () => {
    createLegacyBusDb([
      { type: "fact", content: "Unique fact for dedup test" },
    ]);

    const { runKnowledgeMigrate } = await import("./knowledge-migrate.js");
    await runKnowledgeMigrate({ context: "default" });
    await runKnowledgeMigrate({ context: "default" });

    const { KnowledgeBus } = await import("../core/knowledge-bus.js");
    const bus = await KnowledgeBus.create(join(aiosHome, "knowledge"));
    const ctx = { trace_id: randomUUID(), context_id: "default", started_at: Date.now() };
    const results = await bus.search("Unique fact for dedup", ctx);
    expect(results.length).toBe(1);
    await bus.close();
  });

  it("should migrate legacy KnowledgeBase (knowledge table)", async () => {
    createLegacyKnowledgeDb([
      { type: "decision", content: "Use TypeScript strict mode everywhere" },
    ]);

    const { runKnowledgeMigrate } = await import("./knowledge-migrate.js");
    await runKnowledgeMigrate({ context: "default" });

    const { KnowledgeBus } = await import("../core/knowledge-bus.js");
    const bus = await KnowledgeBus.create(join(aiosHome, "knowledge"));
    const ctx = { trace_id: randomUUID(), context_id: "default", started_at: Date.now() };
    const results = await bus.search("TypeScript strict", ctx);
    expect(results.length).toBe(1);
    await bus.close();
  });

  it("should report counts in dry-run mode without writing", async () => {
    createLegacyBusDb([
      { type: "fact", content: "dry run test content" },
    ]);

    const { runKnowledgeMigrate } = await import("./knowledge-migrate.js");
    await runKnowledgeMigrate({ context: "default", dryRun: true });

    const lanceDir = join(aiosHome, "knowledge", "messages.lance");
    expect(existsSync(lanceDir)).toBe(false);
  });

  it("should handle no legacy databases gracefully", async () => {
    const { runKnowledgeMigrate } = await import("./knowledge-migrate.js");
    await runKnowledgeMigrate({ context: "default" });
  });

  it("should assign wing based on type", async () => {
    createLegacyBusDb([
      { type: "decision", content: "Architecture decision about kernel" },
    ]);

    const { runKnowledgeMigrate } = await import("./knowledge-migrate.js");
    await runKnowledgeMigrate({ context: "default" });

    const { KnowledgeBus } = await import("../core/knowledge-bus.js");
    const bus = await KnowledgeBus.create(join(aiosHome, "knowledge"));
    const ctx = { trace_id: randomUUID(), context_id: "default", started_at: Date.now() };
    const results = await bus.search("Architecture decision", ctx);
    expect(results.length).toBe(1);
    expect(results[0].wing).toBe("wing_aios_decisions");
    await bus.close();
  });

  it("should migrate both bus.db and knowledge.db together", async () => {
    createLegacyBusDb([
      { type: "fact", content: "Bus fact for dual test" },
    ]);
    createLegacyKnowledgeDb([
      { type: "decision", content: "KB decision for dual test" },
    ]);

    const { runKnowledgeMigrate } = await import("./knowledge-migrate.js");
    await runKnowledgeMigrate({ context: "default" });

    const { KnowledgeBus } = await import("../core/knowledge-bus.js");
    const bus = await KnowledgeBus.create(join(aiosHome, "knowledge"));
    const ctx = { trace_id: randomUUID(), context_id: "default", started_at: Date.now() };
    const busFact = await bus.search("Bus fact for dual", ctx);
    const kbDecision = await bus.search("KB decision for dual", ctx);
    expect(busFact.length).toBe(1);
    expect(kbDecision.length).toBe(1);
    await bus.close();
  });

  it("should handle corrupt SQLite file gracefully", async () => {
    const { writeFileSync } = await import("fs");
    const corruptPath = join(aiosHome, "knowledge", "bus.db.pre-lance.bak");
    writeFileSync(corruptPath, "this is not a sqlite database");

    const { runKnowledgeMigrate } = await import("./knowledge-migrate.js");
    await runKnowledgeMigrate({ context: "default" });
  });

  it("should handle SQLite file with missing messages table", async () => {
    const dbPath = join(aiosHome, "knowledge", "bus.db.pre-lance.bak");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE other_table (id TEXT)");
    db.close();

    const { runKnowledgeMigrate } = await import("./knowledge-migrate.js");
    await runKnowledgeMigrate({ context: "default" });
  });
});
