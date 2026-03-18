import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { VectorDocument, SearchResult, CollectionStats } from "./types.js";

// ─── Row types ──────────────────────────────────────────

interface VectorRow {
  id: string;
  collection: string;
  chunk_index: number;
  content: string;
  metadata: string;
  embedding: Buffer;
  model_id: string;
  created_at: string;
}

// ─── Cosine Similarity (JS brute-force) ─────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  // Assumes vectors are L2-normalized → cosine = dot product
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

// ─── VectorStore ────────────────────────────────────────

export class VectorStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT NOT NULL,
        collection TEXT NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        embedding BLOB NOT NULL,
        model_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (id, collection, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_collection ON vectors(collection);
    `);
  }

  /** Insert or update a document chunk */
  upsert(doc: VectorDocument): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (id, collection, chunk_index, content, metadata, embedding, model_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      doc.id,
      doc.collection,
      doc.chunkIndex,
      doc.content,
      JSON.stringify(doc.metadata),
      float32ToBuffer(doc.embedding),
      doc.modelId,
      doc.createdAt,
    );
  }

  /** Bulk upsert within a transaction */
  upsertMany(docs: VectorDocument[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (id, collection, chunk_index, content, metadata, embedding, model_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const doc of docs) {
        stmt.run(
          doc.id,
          doc.collection,
          doc.chunkIndex,
          doc.content,
          JSON.stringify(doc.metadata),
          float32ToBuffer(doc.embedding),
          doc.modelId,
          doc.createdAt,
        );
      }
    });
    tx();
  }

  /** Semantic search: brute-force cosine similarity in JS */
  search(
    collection: string,
    queryEmbedding: Float32Array,
    topK: number,
    minScore: number = 0,
    metadataFilter?: Record<string, unknown>,
  ): SearchResult[] {
    const rows = this.db
      .prepare("SELECT * FROM vectors WHERE collection = ?")
      .all(collection) as VectorRow[];

    const scored: SearchResult[] = [];

    for (const row of rows) {
      // Metadata filter
      if (metadataFilter) {
        const meta = JSON.parse(row.metadata) as Record<string, unknown>;
        let match = true;
        for (const [key, val] of Object.entries(metadataFilter)) {
          if (meta[key] !== val) { match = false; break; }
        }
        if (!match) continue;
      }

      const embedding = bufferToFloat32(row.embedding as unknown as Buffer);
      const score = cosineSimilarity(queryEmbedding, embedding);

      if (score >= minScore) {
        scored.push({
          id: row.id,
          content: row.content,
          metadata: JSON.parse(row.metadata),
          score,
          chunkIndex: row.chunk_index,
        });
      }
    }

    // Sort by score descending, take topK
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Get all embeddings for given IDs in a collection */
  getEmbeddings(collection: string, ids: string[]): Map<string, Float32Array[]> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT id, chunk_index, embedding FROM vectors WHERE collection = ? AND id IN (${placeholders}) ORDER BY id, chunk_index`)
      .all(collection, ...ids) as Array<{ id: string; chunk_index: number; embedding: Buffer }>;

    const result = new Map<string, Float32Array[]>();
    for (const row of rows) {
      const existing = result.get(row.id) ?? [];
      existing.push(bufferToFloat32(row.embedding as unknown as Buffer));
      result.set(row.id, existing);
    }
    return result;
  }

  /** Delete all chunks for an ID in a collection */
  delete(collection: string, id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM vectors WHERE collection = ? AND id = ?")
      .run(collection, id);
    return result.changes > 0;
  }

  /** Delete entire collection */
  deleteCollection(collection: string): number {
    const result = this.db
      .prepare("DELETE FROM vectors WHERE collection = ?")
      .run(collection);
    return result.changes;
  }

  /** Collection statistics */
  stats(collection?: string): CollectionStats[] {
    const query = collection
      ? "SELECT collection, COUNT(DISTINCT id) as doc_count, MIN(model_id) as model_id FROM vectors WHERE collection = ? GROUP BY collection"
      : "SELECT collection, COUNT(DISTINCT id) as doc_count, MIN(model_id) as model_id FROM vectors GROUP BY collection";
    const rows = collection
      ? this.db.prepare(query).all(collection) as Array<{ collection: string; doc_count: number; model_id: string | null }>
      : this.db.prepare(query).all() as Array<{ collection: string; doc_count: number; model_id: string | null }>;

    return rows.map((r) => ({
      collection: r.collection,
      documentCount: r.doc_count,
      modelId: r.model_id,
    }));
  }

  /** Check if collection needs reindex (model changed) */
  needsReindex(collection: string, modelId: string): boolean {
    const row = this.db
      .prepare("SELECT model_id FROM vectors WHERE collection = ? LIMIT 1")
      .get(collection) as { model_id: string } | undefined;
    if (!row) return false; // empty collection, no reindex needed
    return row.model_id !== modelId;
  }

  close(): void {
    this.db.close();
  }
}
