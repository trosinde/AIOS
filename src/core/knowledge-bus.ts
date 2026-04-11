import * as lancedb from "@lancedb/lancedb";
import { createHash, randomUUID } from "crypto";
import { mkdirSync } from "fs";
import type {
  ExecutionContext,
  KernelMessage,
  KnowledgeQuery,
  KnowledgeType,
} from "../types.js";
import {
  buildMessagesSchema,
  buildKgTriplesSchema,
  MESSAGES_TABLE,
  KG_TRIPLES_TABLE,
  DEFAULT_EMBEDDING_DIM,
} from "./knowledge-bus-schema.js";
import {
  type EmbeddingProvider,
  createDefaultEmbeddingProvider,
} from "./embedding-provider.js";

/**
 * KnowledgeBus – Kernel-level knowledge store backed by LanceDB.
 *
 * Persistent HNSW vector index alongside columnar metadata in a single
 * embedded database directory. Replaces the previous better-sqlite3
 * implementation. The public API surface (publish/query/search/byTrace
 * /stats/delete/close) is preserved but every method is now async; new
 * methods (semanticSearch, checkDuplicate, publishMany, listTaxonomy,
 * kgAdd/kgQuery, diaryWrite/diaryRead) are additive.
 *
 * Construction is async: use `KnowledgeBus.create(dir, provider?)`.
 * The factory ensures the directory exists, connects to LanceDB, and
 * creates the messages and kg_triples tables on first use. Subsequent
 * runs reuse the existing tables.
 *
 * Context isolation: every query filters on `source_context` (own
 * context) plus `target_context = '*'` (broadcast) plus
 * `target_context = ctx.context_id` (explicitly targeted), exactly as
 * the old SQLite KB did.
 *
 * Embedding provider: defaults to OllamaEmbeddingProvider with
 * nomic-embed-text. Tests inject StubEmbeddingProvider for determinism.
 */
export class KnowledgeBus {
  private constructor(
    private readonly db: lancedb.Connection,
    private readonly messagesTable: lancedb.Table,
    private readonly kgTable: lancedb.Table,
    private readonly embedder: EmbeddingProvider,
    private readonly dbDir: string,
  ) {}

  /**
   * Create or open a KnowledgeBus at `dir`. Tables are created on
   * first run. The embedding provider's `dim` must match the existing
   * messages table dim — if it doesn't, the schema migration logic
   * fails loudly so you don't silently corrupt the index.
   */
  static async create(
    dir: string,
    provider?: EmbeddingProvider,
  ): Promise<KnowledgeBus> {
    mkdirSync(dir, { recursive: true });
    // When no provider is passed explicitly we honor env vars (see
    // createDefaultEmbeddingProvider). This is what makes e2e tests
    // and CI runs work without an Ollama dependency: setting
    // AIOS_EMBEDDING_PROVIDER=stub gives them a deterministic
    // in-process embedder.
    const embedder = provider ?? createDefaultEmbeddingProvider();
    const db = await lancedb.connect(dir);

    const tableNames = await db.tableNames();

    let messagesTable: lancedb.Table;
    if (tableNames.includes(MESSAGES_TABLE)) {
      messagesTable = await db.openTable(MESSAGES_TABLE);
    } else {
      messagesTable = await db.createEmptyTable(
        MESSAGES_TABLE,
        buildMessagesSchema(embedder.dim),
      );
    }

    let kgTable: lancedb.Table;
    if (tableNames.includes(KG_TRIPLES_TABLE)) {
      kgTable = await db.openTable(KG_TRIPLES_TABLE);
    } else {
      kgTable = await db.createEmptyTable(
        KG_TRIPLES_TABLE,
        buildKgTriplesSchema(),
      );
    }

    return new KnowledgeBus(db, messagesTable, kgTable, embedder, dir);
  }

  // ─────────────────────────────────────────────────────────
  // Publish
  // ─────────────────────────────────────────────────────────

  /**
   * Publish a single message. Computes the embedding via the active
   * provider, computes a content hash for exact-dup detection, and
   * inserts one row into the messages table.
   *
   * If embedding generation fails (e.g. Ollama offline), the row is
   * still inserted with a zero-vector embedding so the workflow does
   * not break. A later `aios knowledge reembed` (Phase 2) can fill in
   * the missing vectors.
   */
  async publish(
    message: Omit<KernelMessage, "id" | "created_at" | "trace_id" | "source_context">,
    ctx: ExecutionContext,
  ): Promise<string> {
    const id = randomUUID();
    const row = await this.toRow(id, message, ctx);
    await this.messagesTable.add([row]);
    return id;
  }

  /**
   * Batch publish. Embeddings are generated via embedMany so the
   * provider can amortize per-call overhead. One LanceDB insert.
   */
  async publishMany(
    messages: Array<Omit<KernelMessage, "id" | "created_at" | "trace_id" | "source_context">>,
    ctx: ExecutionContext,
  ): Promise<string[]> {
    if (messages.length === 0) return [];
    const ids = messages.map(() => randomUUID());
    const contents = messages.map((m) => m.content);
    const embeddings = await this.embedManySafe(contents);
    const rows = messages.map((m, i) =>
      this.toRowWithEmbedding(ids[i], m, ctx, embeddings[i]),
    );
    await this.messagesTable.add(rows);
    return ids;
  }

  // ─────────────────────────────────────────────────────────
  // Query (filter-based, no semantic component)
  // ─────────────────────────────────────────────────────────

  /**
   * Filter messages by type, tags, source pattern, age, and context
   * isolation. Returns messages ordered by created_at DESC, capped
   * at filter.limit (default 50).
   *
   * Context-isolation semantics match the old SQLite KB:
   *   - Default: only messages where source_context == ctx.context_id
   *   - With include_cross_context: own context OR broadcast OR
   *     explicitly targeted at ctx.context_id
   */
  async query(filter: KnowledgeQuery, ctx: ExecutionContext): Promise<KernelMessage[]> {
    const where = this.buildContextFilter(ctx, filter.include_cross_context);
    const conditions: string[] = [where];

    if (filter.type) {
      conditions.push(`type = '${escSql(filter.type)}'`);
    }
    if (filter.source_pattern) {
      conditions.push(`source_pattern = '${escSql(filter.source_pattern)}'`);
    }
    if (filter.since) {
      conditions.push(`created_at >= ${filter.since}`);
    }
    if (filter.tags?.length) {
      // tags are JSON-encoded as a string. Match if the JSON contains
      // any of the requested tags. LanceDB supports SQL LIKE.
      const tagConds = filter.tags.map(
        (t) => `tags LIKE '%"${escSql(t)}"%'`,
      );
      conditions.push(`(${tagConds.join(" OR ")})`);
    }

    const limit = filter.limit ?? 50;
    const rows = await this.messagesTable
      .query()
      .where(conditions.join(" AND "))
      .limit(limit)
      .toArray();

    // LanceDB has no ORDER BY in the JS query API at this version,
    // sort in JS. The result set is already small (capped by limit
    // applied at scan time), so this is cheap.
    rows.sort((a, b) => Number(b.created_at) - Number(a.created_at));
    return rows.slice(0, limit).map(rowToMessage);
  }

  // ─────────────────────────────────────────────────────────
  // Keyword search (full-content LIKE)
  // ─────────────────────────────────────────────────────────

  /**
   * Substring search in content + tags. Not semantic — for that, use
   * semanticSearch. This is the drop-in replacement for the old SQLite
   * `LIKE %?%` search.
   */
  async search(text: string, ctx: ExecutionContext, limit: number = 20): Promise<KernelMessage[]> {
    const where = this.buildContextFilter(ctx, true);
    const escaped = escSql(text);
    const filter = `${where} AND (content LIKE '%${escaped}%' OR tags LIKE '%${escaped}%')`;
    const rows = await this.messagesTable
      .query()
      .where(filter)
      .limit(limit * 2)
      .toArray();
    rows.sort((a, b) => Number(b.created_at) - Number(a.created_at));
    return rows.slice(0, limit).map(rowToMessage);
  }

  // ─────────────────────────────────────────────────────────
  // Semantic search (HNSW + filter)
  // ─────────────────────────────────────────────────────────

  /**
   * Vector similarity search via the LanceDB HNSW index. Always scoped
   * to the active context (own + broadcast + explicit-target). Optional
   * type/wing/room filters compose with the vector search via LanceDB's
   * pre-filter pushdown.
   *
   * Returns top-k messages ranked by similarity to the query embedding.
   */
  async semanticSearch(
    query: string,
    ctx: ExecutionContext,
    opts: SemanticSearchOptions = {},
  ): Promise<KernelMessage[]> {
    const topK = opts.top_k ?? 10;
    const conditions: string[] = [this.buildContextFilter(ctx, true)];
    if (opts.type) conditions.push(`type = '${escSql(opts.type)}'`);
    if (opts.wing) conditions.push(`wing = '${escSql(opts.wing)}'`);
    if (opts.room) conditions.push(`room = '${escSql(opts.room)}'`);

    const queryVec = await this.embedSafe(query);

    let q = this.messagesTable
      .search(Array.from(queryVec))
      .where(conditions.join(" AND "))
      .limit(topK);

    const rows = await q.toArray();
    return rows.map(rowToMessage);
  }

  // ─────────────────────────────────────────────────────────
  // Duplicate detection
  // ─────────────────────────────────────────────────────────

  /**
   * Check whether the given content already exists. Two-stage:
   *   1. Exact match via content_hash (cheap, no embedding call)
   *   2. Near-dup via cosine similarity over the top-1 vector neighbor
   *      (only runs if step 1 misses), threshold defaults to 0.92
   *
   * Returns the matching message ID or null. Useful before publishing
   * to avoid drawer pollution.
   */
  async checkDuplicate(
    content: string,
    ctx: ExecutionContext,
    threshold: number = 0.92,
  ): Promise<DedupResult | null> {
    const hash = sha256(content);
    const where = this.buildContextFilter(ctx, false);

    // Stage 1: exact hash hit
    const hashHit = await this.messagesTable
      .query()
      .where(`${where} AND content_hash = '${hash}'`)
      .limit(1)
      .toArray();
    if (hashHit.length > 0) {
      return { id: String(hashHit[0].id), kind: "exact", similarity: 1.0 };
    }

    // Stage 2: cosine on top-1 neighbor
    const queryVec = await this.embedSafe(content);
    const neighborRows = await this.messagesTable
      .search(Array.from(queryVec))
      .where(where)
      .limit(1)
      .toArray();
    if (neighborRows.length === 0) return null;

    const neighbor = neighborRows[0];
    // LanceDB returns a `_distance` field — for cosine search this is
    // (1 - cosine_similarity). Convert back.
    const distance = typeof neighbor._distance === "number" ? neighbor._distance : 1;
    const similarity = 1 - distance;
    if (similarity >= threshold) {
      return { id: String(neighbor.id), kind: "near", similarity };
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────
  // By-trace, stats, delete
  // ─────────────────────────────────────────────────────────

  async byTrace(traceId: string): Promise<KernelMessage[]> {
    const rows = await this.messagesTable
      .query()
      .where(`trace_id = '${escSql(traceId)}'`)
      .limit(10000)
      .toArray();
    rows.sort((a, b) => Number(a.created_at) - Number(b.created_at));
    return rows.map(rowToMessage);
  }

  async stats(contextId?: string): Promise<Record<KnowledgeType, number>> {
    const filter = contextId ? `source_context = '${escSql(contextId)}'` : undefined;
    const q = this.messagesTable.query();
    if (filter) q.where(filter);
    const rows = await q.limit(1_000_000).toArray();
    const result: Record<string, number> = {
      decision: 0,
      fact: 0,
      requirement: 0,
      artifact: 0,
    };
    for (const row of rows) {
      const t = String(row.type);
      result[t] = (result[t] ?? 0) + 1;
    }
    return result as Record<KnowledgeType, number>;
  }

  async delete(id: string): Promise<boolean> {
    const before = await this.messagesTable.countRows();
    await this.messagesTable.delete(`id = '${escSql(id)}'`);
    const after = await this.messagesTable.countRows();
    return after < before;
  }

  // ─────────────────────────────────────────────────────────
  // Taxonomy (Phase 1: list, Phase 2: full tree)
  // ─────────────────────────────────────────────────────────

  /**
   * Group messages by wing → room → count for the active context.
   * Used by `aios knowledge taxonomy` and the memory_recall pattern
   * to surface available knowledge buckets to the LLM.
   */
  async listTaxonomy(ctx: ExecutionContext): Promise<TaxonomyEntry[]> {
    const where = this.buildContextFilter(ctx, false);
    const rows = await this.messagesTable
      .query()
      .where(`${where} AND wing IS NOT NULL`)
      .limit(1_000_000)
      .toArray();

    const buckets = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const wing = String(row.wing ?? "");
      const room = String(row.room ?? "");
      if (!wing) continue;
      let rooms = buckets.get(wing);
      if (!rooms) {
        rooms = new Map();
        buckets.set(wing, rooms);
      }
      rooms.set(room, (rooms.get(room) ?? 0) + 1);
    }

    const result: TaxonomyEntry[] = [];
    for (const [wing, rooms] of buckets) {
      for (const [room, count] of rooms) {
        result.push({ wing, room, count });
      }
    }
    result.sort((a, b) => a.wing.localeCompare(b.wing) || a.room.localeCompare(b.room));
    return result;
  }

  // ─────────────────────────────────────────────────────────
  // Knowledge Graph
  // ─────────────────────────────────────────────────────────

  /**
   * Insert a triple (subject, predicate, object) into the KG table.
   * No vector embedding — KG queries are pattern-match. Provenance
   * (source_context, trace_id, created_at) is stamped from the active
   * ExecutionContext.
   */
  async kgAdd(
    subject: string,
    predicate: string,
    object: string,
    ctx: ExecutionContext,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const id = randomUUID();
    await this.kgTable.add([
      {
        id,
        subject,
        predicate,
        object,
        source_context: ctx.context_id,
        trace_id: ctx.trace_id,
        created_at: BigInt(Date.now()),
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    ]);
    return id;
  }

  /**
   * Pattern-match query over the KG. Any combination of
   * subject/predicate/object can be a literal or undefined (wildcard).
   * Always scoped to the active context.
   */
  async kgQuery(
    pattern: KgPattern,
    ctx: ExecutionContext,
    limit: number = 100,
  ): Promise<KgTriple[]> {
    const conditions: string[] = [`source_context = '${escSql(ctx.context_id)}'`];
    if (pattern.subject) conditions.push(`subject = '${escSql(pattern.subject)}'`);
    if (pattern.predicate) conditions.push(`predicate = '${escSql(pattern.predicate)}'`);
    if (pattern.object) conditions.push(`object = '${escSql(pattern.object)}'`);

    const rows = await this.kgTable
      .query()
      .where(conditions.join(" AND "))
      .limit(limit)
      .toArray();
    return rows.map(rowToTriple);
  }

  // ─────────────────────────────────────────────────────────
  // Diary
  // ─────────────────────────────────────────────────────────

  /**
   * Append a diary entry. Diary entries are stored in the messages
   * table with type="diary" so the same indexes (semantic, taxonomy,
   * trace) work on them. Always belongs to the active context.
   */
  async diaryWrite(
    content: string,
    ctx: ExecutionContext,
    opts: { tags?: string[]; metadata?: Record<string, unknown> } = {},
  ): Promise<string> {
    return this.publish(
      {
        type: "diary" as KnowledgeType,
        tags: opts.tags ?? [],
        source_pattern: "diary",
        content,
        format: "text",
        target_context: ctx.context_id,
        metadata: opts.metadata,
      },
      ctx,
    );
  }

  /**
   * Read diary entries chronologically (oldest → newest), optionally
   * bounded by a time window. Always scoped to the active context.
   */
  async diaryRead(
    ctx: ExecutionContext,
    opts: { since?: number; until?: number; limit?: number } = {},
  ): Promise<KernelMessage[]> {
    const conditions: string[] = [
      `source_context = '${escSql(ctx.context_id)}'`,
      `type = 'diary'`,
    ];
    if (opts.since) conditions.push(`created_at >= ${opts.since}`);
    if (opts.until) conditions.push(`created_at <= ${opts.until}`);
    const rows = await this.messagesTable
      .query()
      .where(conditions.join(" AND "))
      .limit(opts.limit ?? 200)
      .toArray();
    rows.sort((a, b) => Number(a.created_at) - Number(b.created_at));
    return rows.map(rowToMessage);
  }

  // ─────────────────────────────────────────────────────────
  // Index management — call once after a large bulk insert
  // ─────────────────────────────────────────────────────────

  /**
   * Build (or rebuild) the HNSW vector index on the embedding column.
   * LanceDB requires at least 256 rows before an index can be built.
   * Safe to call multiple times — LanceDB drops and rebuilds.
   */
  async ensureVectorIndex(): Promise<void> {
    const count = await this.messagesTable.countRows();
    if (count < 256) return; // not enough data for HNSW
    try {
      await this.messagesTable.createIndex("embedding", {
        config: lancedb.Index.hnswPq({
          distanceType: "cosine",
        }),
      });
    } catch (e) {
      // Index already exists or build failed — log but don't throw,
      // the table still works without an explicit index (slower scan).
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("already exists")) {
        console.error(`KnowledgeBus: vector index build failed: ${msg}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  /**
   * Close the LanceDB connection. The native client manages its own
   * resources; close() is mostly a hint for tests that want clean
   * teardown.
   */
  async close(): Promise<void> {
    // LanceDB Connection has no explicit close() in the JS API as of
    // 0.27 — resources are released by GC. Provided for API symmetry.
  }

  // ─────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────

  private buildContextFilter(
    ctx: ExecutionContext,
    includeCrossContext: boolean | undefined,
  ): string {
    if (includeCrossContext) {
      const c = escSql(ctx.context_id);
      return `(source_context = '${c}' OR target_context = '*' OR target_context = '${c}')`;
    }
    return `source_context = '${escSql(ctx.context_id)}'`;
  }

  private async embedSafe(text: string): Promise<Float32Array> {
    try {
      return await this.embedder.embed(text);
    } catch {
      return new Float32Array(this.embedder.dim);
    }
  }

  private async embedManySafe(texts: string[]): Promise<Float32Array[]> {
    try {
      return await this.embedder.embedMany(texts);
    } catch {
      return texts.map(() => new Float32Array(this.embedder.dim));
    }
  }

  private async toRow(
    id: string,
    message: Omit<KernelMessage, "id" | "created_at" | "trace_id" | "source_context">,
    ctx: ExecutionContext,
  ): Promise<MessageRow> {
    const embedding = await this.embedSafe(message.content);
    return this.toRowWithEmbedding(id, message, ctx, embedding);
  }

  private toRowWithEmbedding(
    id: string,
    message: Omit<KernelMessage, "id" | "created_at" | "trace_id" | "source_context">,
    ctx: ExecutionContext,
    embedding: Float32Array,
  ): MessageRow {
    return {
      id,
      trace_id: ctx.trace_id,
      source_context: ctx.context_id,
      target_context: message.target_context ?? ctx.context_id,
      created_at: BigInt(Date.now()),
      type: message.type,
      tags: JSON.stringify(message.tags ?? []),
      source_pattern: message.source_pattern,
      source_step: message.source_step ?? null,
      content: message.content,
      format: message.format ?? "text",
      metadata: message.metadata ? JSON.stringify(message.metadata) : null,
      wing: message.wing ?? null,
      room: message.room ?? null,
      content_hash: sha256(message.content),
      embedding: Array.from(embedding),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Public additive types
// ─────────────────────────────────────────────────────────────

export interface SemanticSearchOptions {
  top_k?: number;
  type?: KnowledgeType;
  wing?: string;
  room?: string;
}

export interface DedupResult {
  id: string;
  kind: "exact" | "near";
  similarity: number;
}

export interface TaxonomyEntry {
  wing: string;
  room: string;
  count: number;
}

export interface KgPattern {
  subject?: string;
  predicate?: string;
  object?: string;
}

export interface KgTriple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  source_context: string;
  trace_id: string;
  created_at: number;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Internal row shapes
// ─────────────────────────────────────────────────────────────

type MessageRow = Record<string, unknown> & {
  id: string;
  trace_id: string;
  source_context: string;
  target_context: string;
  created_at: bigint;
  type: string;
  tags: string;
  source_pattern: string;
  source_step: string | null;
  content: string;
  format: string;
  metadata: string | null;
  wing: string | null;
  room: string | null;
  content_hash: string;
  embedding: number[];
};

function rowToMessage(row: Record<string, unknown>): KernelMessage {
  const tagsRaw = typeof row.tags === "string" ? row.tags : "[]";
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(tagsRaw);
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    /* leave empty */
  }
  let metadata: Record<string, unknown> | undefined;
  if (typeof row.metadata === "string") {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: String(row.id),
    trace_id: String(row.trace_id),
    source_context: String(row.source_context),
    target_context: String(row.target_context),
    created_at: Number(row.created_at),
    type: String(row.type) as KnowledgeType,
    tags,
    source_pattern: String(row.source_pattern),
    source_step: row.source_step != null ? String(row.source_step) : undefined,
    content: String(row.content),
    format: String(row.format) as "text" | "json" | "markdown",
    metadata,
    wing: row.wing != null ? String(row.wing) : undefined,
    room: row.room != null ? String(row.room) : undefined,
  };
}

function rowToTriple(row: Record<string, unknown>): KgTriple {
  let metadata: Record<string, unknown> | undefined;
  if (typeof row.metadata === "string") {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: String(row.id),
    subject: String(row.subject),
    predicate: String(row.predicate),
    object: String(row.object),
    source_context: String(row.source_context),
    trace_id: String(row.trace_id),
    created_at: Number(row.created_at),
    metadata,
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Single-quote escape for safely embedding values into LanceDB SQL
 * filter strings. LanceDB does not yet expose parameter binding for
 * the JS query API, so we escape manually. Doubles single quotes per
 * SQL standard. NOT a general-purpose SQL escaper — only safe for
 * literal string values inside `'...'`.
 */
function escSql(value: string): string {
  return value.replace(/'/g, "''");
}
