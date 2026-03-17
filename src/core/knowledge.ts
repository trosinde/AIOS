import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { KnowledgeItem, KnowledgeType } from "../types.js";

/**
 * KnowledgeBase – SQLite-basierter Wissensspeicher.
 * Speichert Decisions, Facts, Requirements und Artifacts
 * die aus Agent-Outputs extrahiert werden.
 */
export class KnowledgeBase {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('decision', 'fact', 'requirement', 'artifact')),
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        project TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge(type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project);
    `);
  }

  /** Neues Wissensitem speichern */
  add(item: Omit<KnowledgeItem, "id" | "created_at">): KnowledgeItem {
    const id = randomUUID();
    const created_at = new Date().toISOString();
    const stmt = this.db.prepare(
      "INSERT INTO knowledge (id, type, content, source, tags, project, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    stmt.run(id, item.type, item.content, item.source, JSON.stringify(item.tags), item.project ?? null, created_at);
    return { id, created_at, ...item };
  }

  /** Nach Typ filtern */
  byType(type: KnowledgeType, project?: string): KnowledgeItem[] {
    const stmt = project
      ? this.db.prepare("SELECT * FROM knowledge WHERE type = ? AND project = ? ORDER BY created_at DESC")
      : this.db.prepare("SELECT * FROM knowledge WHERE type = ? ORDER BY created_at DESC");
    const rows = project ? stmt.all(type, project) : stmt.all(type);
    return (rows as Row[]).map(rowToItem);
  }

  /** Volltextsuche über content und tags */
  search(query: string, project?: string): KnowledgeItem[] {
    const pattern = `%${query}%`;
    const stmt = project
      ? this.db.prepare("SELECT * FROM knowledge WHERE (content LIKE ? OR tags LIKE ?) AND project = ? ORDER BY created_at DESC")
      : this.db.prepare("SELECT * FROM knowledge WHERE (content LIKE ? OR tags LIKE ?) ORDER BY created_at DESC");
    const rows = project ? stmt.all(pattern, pattern, project) : stmt.all(pattern, pattern);
    return (rows as Row[]).map(rowToItem);
  }

  /** Alle Items (optional nach Projekt) */
  all(project?: string): KnowledgeItem[] {
    const stmt = project
      ? this.db.prepare("SELECT * FROM knowledge WHERE project = ? ORDER BY created_at DESC")
      : this.db.prepare("SELECT * FROM knowledge ORDER BY created_at DESC");
    const rows = project ? stmt.all(project) : stmt.all();
    return (rows as Row[]).map(rowToItem);
  }

  /** Statistiken */
  stats(project?: string): Record<KnowledgeType, number> {
    const where = project ? "WHERE project = ?" : "";
    const stmt = this.db.prepare(`SELECT type, COUNT(*) as count FROM knowledge ${where} GROUP BY type`);
    const rows = project ? stmt.all(project) : stmt.all();
    const result: Record<string, number> = { decision: 0, fact: 0, requirement: 0, artifact: 0 };
    for (const row of rows as Array<{ type: string; count: number }>) {
      result[row.type] = row.count;
    }
    return result as Record<KnowledgeType, number>;
  }

  /** Ein Item löschen */
  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM knowledge WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** DB schließen */
  close(): void {
    this.db.close();
  }
}

// ─── Helpers ──────────────────────────────────────────────

interface Row {
  id: string;
  type: string;
  content: string;
  source: string;
  tags: string;
  project: string | null;
  created_at: string;
}

function rowToItem(row: Row): KnowledgeItem {
  return {
    id: row.id,
    type: row.type as KnowledgeType,
    content: row.content,
    source: row.source,
    tags: JSON.parse(row.tags),
    project: row.project ?? undefined,
    created_at: row.created_at,
  };
}
