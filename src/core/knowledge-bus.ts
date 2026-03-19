import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type {
  ExecutionContext,
  KernelMessage,
  KnowledgeQuery,
  KnowledgeType,
} from "../types.js";

/**
 * KnowledgeBus – Kernel-level Knowledge Store mit Context-Isolation.
 *
 * Erweitert das bestehende KnowledgeBase-Konzept um:
 * - ExecutionContext-Integration (trace_id, context_id)
 * - Context-Isolation (Queries filtern auf context_id)
 * - Cross-Context IPC (target_context = "*" oder explizit)
 * - KernelMessage-Format (kernel-stable)
 */
export class KnowledgeBus {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        source_context TEXT NOT NULL,
        target_context TEXT NOT NULL DEFAULT '*',
        created_at INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('decision', 'fact', 'requirement', 'artifact')),
        tags TEXT NOT NULL DEFAULT '[]',
        source_pattern TEXT NOT NULL,
        source_step TEXT,
        content TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'text',
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_msg_context ON messages(source_context, type);
      CREATE INDEX IF NOT EXISTS idx_msg_target ON messages(target_context);
      CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_msg_trace ON messages(trace_id);
    `);
  }

  /**
   * Publish a message to the Knowledge Bus.
   * Automatically sets id, created_at, trace_id, and source_context from ExecutionContext.
   */
  publish(
    message: Omit<KernelMessage, "id" | "created_at" | "trace_id" | "source_context">,
    ctx: ExecutionContext
  ): string {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, trace_id, source_context, target_context, created_at, type, tags, source_pattern, source_step, content, format, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      ctx.trace_id,
      ctx.context_id,
      message.target_context ?? ctx.context_id,
      Date.now(),
      message.type,
      JSON.stringify(message.tags),
      message.source_pattern,
      message.source_step ?? null,
      message.content,
      message.format ?? "text",
      message.metadata ? JSON.stringify(message.metadata) : null,
    );
    return id;
  }

  /**
   * Query messages with context isolation.
   * Only returns messages from own context + broadcasts + explicitly targeted messages.
   */
  query(filter: KnowledgeQuery, ctx: ExecutionContext): KernelMessage[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Context isolation: own context OR broadcast OR explicitly targeted
    if (filter.include_cross_context) {
      conditions.push("(source_context = ? OR target_context = '*' OR target_context = ?)");
      params.push(ctx.context_id, ctx.context_id);
    } else {
      conditions.push("source_context = ?");
      params.push(ctx.context_id);
    }

    if (filter.type) {
      conditions.push("type = ?");
      params.push(filter.type);
    }

    if (filter.source_pattern) {
      conditions.push("source_pattern = ?");
      params.push(filter.source_pattern);
    }

    if (filter.since) {
      conditions.push("created_at >= ?");
      params.push(filter.since);
    }

    if (filter.tags?.length) {
      // Match if any tag matches
      const tagConditions = filter.tags.map(() => "tags LIKE ?");
      conditions.push(`(${tagConditions.join(" OR ")})`);
      for (const tag of filter.tags) {
        params.push(`%"${tag}"%`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 50;

    const sql = `SELECT * FROM messages ${where} ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as MessageRow[];
    return rows.map(rowToMessage);
  }

  /**
   * Full-text search in message content.
   */
  search(text: string, ctx: ExecutionContext, limit: number = 20): KernelMessage[] {
    const pattern = `%${text}%`;
    const sql = `
      SELECT * FROM messages
      WHERE (source_context = ? OR target_context = '*' OR target_context = ?)
        AND (content LIKE ? OR tags LIKE ?)
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(ctx.context_id, ctx.context_id, pattern, pattern, limit) as MessageRow[];
    return rows.map(rowToMessage);
  }

  /**
   * Get all messages for a specific trace (workflow execution).
   */
  byTrace(traceId: string): KernelMessage[] {
    const rows = this.db.prepare(
      "SELECT * FROM messages WHERE trace_id = ? ORDER BY created_at ASC"
    ).all(traceId) as MessageRow[];
    return rows.map(rowToMessage);
  }

  /**
   * Get statistics per context.
   */
  stats(contextId?: string): Record<KnowledgeType, number> {
    const where = contextId ? "WHERE source_context = ?" : "";
    const stmt = this.db.prepare(
      `SELECT type, COUNT(*) as count FROM messages ${where} GROUP BY type`
    );
    const rows = contextId ? stmt.all(contextId) : stmt.all();
    const result: Record<string, number> = { decision: 0, fact: 0, requirement: 0, artifact: 0 };
    for (const row of rows as Array<{ type: string; count: number }>) {
      result[row.type] = row.count;
    }
    return result as Record<KnowledgeType, number>;
  }

  /**
   * Delete a message by ID.
   */
  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM messages WHERE id = ?").run(id).changes > 0;
  }

  /**
   * Close database connection.
   */
  close(): void {
    this.db.close();
  }
}

// ─── Internal Types ─────────────────────────────────────

interface MessageRow {
  id: string;
  trace_id: string;
  source_context: string;
  target_context: string;
  created_at: number;
  type: string;
  tags: string;
  source_pattern: string;
  source_step: string | null;
  content: string;
  format: string;
  metadata: string | null;
}

function rowToMessage(row: MessageRow): KernelMessage {
  return {
    id: row.id,
    trace_id: row.trace_id,
    source_context: row.source_context,
    target_context: row.target_context,
    created_at: row.created_at,
    type: row.type as KnowledgeType,
    tags: JSON.parse(row.tags),
    source_pattern: row.source_pattern,
    source_step: row.source_step ?? undefined,
    content: row.content,
    format: row.format as "text" | "json" | "markdown",
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}
