import * as arrow from "apache-arrow";

/**
 * LanceDB schema definitions for the Knowledge Bus.
 *
 * Two tables live side-by-side under one Lance database directory:
 *   - `messages`    – KernelMessage records (typed, indexed, embedded)
 *   - `kg_triples`  – Knowledge graph triples (subject/predicate/object)
 *
 * The vector column on `messages` uses a fixed-size float32 list. The
 * dimension MUST match the embedding provider's output. We default to
 * 768 (`nomic-embed-text`) but the active dimension is read from the
 * embedding provider at connect time and validated against the table.
 *
 * Schema columns are deliberately kept flat — no nested structs — so
 * that LanceDB filter pushdown works on every column.
 */

export const DEFAULT_EMBEDDING_DIM = 768;

/**
 * Build the Arrow schema for the `messages` table.
 *
 * Why each column exists:
 *   id              – primary key (UUID)
 *   trace_id        – ExecutionContext.trace_id, ties a message to a workflow run
 *   source_context  – ContextConfig.name of the publisher (isolation key)
 *   target_context  – "*" for broadcast, otherwise explicit recipient
 *   created_at      – Unix epoch ms
 *   type            – "decision" | "fact" | "requirement" | "artifact" | "diary" | "finding" | "pattern" | "lesson"
 *   tags            – JSON-encoded string[] (LanceDB has no native string-array filter)
 *   source_pattern  – Which pattern emitted the message (e.g. "memory_store")
 *   source_step     – Which step within the workflow (nullable)
 *   content         – The actual knowledge content
 *   format          – "text" | "json" | "markdown"
 *   metadata        – JSON-encoded blob for arbitrary additional fields
 *   wing            – High-level knowledge bucket (e.g. "wing_aios_decisions")
 *   room            – Sub-topic within the wing (e.g. "kernel_abi")
 *   content_hash    – SHA-256 of `content` for exact-duplicate detection
 *   embedding       – Fixed-size vector of float32, dimension dim
 */
export function buildMessagesSchema(dim: number = DEFAULT_EMBEDDING_DIM): arrow.Schema {
  return new arrow.Schema([
    new arrow.Field("id", new arrow.Utf8(), false),
    new arrow.Field("trace_id", new arrow.Utf8(), false),
    new arrow.Field("source_context", new arrow.Utf8(), false),
    new arrow.Field("target_context", new arrow.Utf8(), false),
    new arrow.Field("created_at", new arrow.Int64(), false),
    new arrow.Field("type", new arrow.Utf8(), false),
    new arrow.Field("tags", new arrow.Utf8(), false),
    new arrow.Field("source_pattern", new arrow.Utf8(), false),
    new arrow.Field("source_step", new arrow.Utf8(), true),
    new arrow.Field("content", new arrow.Utf8(), false),
    new arrow.Field("format", new arrow.Utf8(), false),
    new arrow.Field("metadata", new arrow.Utf8(), true),
    new arrow.Field("wing", new arrow.Utf8(), true),
    new arrow.Field("room", new arrow.Utf8(), true),
    new arrow.Field("content_hash", new arrow.Utf8(), false),
    new arrow.Field(
      "embedding",
      new arrow.FixedSizeList(dim, new arrow.Field("item", new arrow.Float32(), true)),
      true,
    ),
  ]);
}

/**
 * Build the Arrow schema for the `kg_triples` table.
 *
 * A triple is `<subject> <predicate> <object>` plus provenance.
 * No vector column — KG queries are pattern-match, not semantic.
 */
export function buildKgTriplesSchema(): arrow.Schema {
  return new arrow.Schema([
    new arrow.Field("id", new arrow.Utf8(), false),
    new arrow.Field("subject", new arrow.Utf8(), false),
    new arrow.Field("predicate", new arrow.Utf8(), false),
    new arrow.Field("object", new arrow.Utf8(), false),
    new arrow.Field("source_context", new arrow.Utf8(), false),
    new arrow.Field("trace_id", new arrow.Utf8(), false),
    new arrow.Field("created_at", new arrow.Int64(), false),
    new arrow.Field("metadata", new arrow.Utf8(), true),
  ]);
}

export const MESSAGES_TABLE = "messages";
export const KG_TRIPLES_TABLE = "kg_triples";

/**
 * Allowed message types. Includes the four "kernel-stable" types from
 * the original KnowledgeBus plus extensions used by the memory_recall/
 * memory_store patterns and the diary subsystem. Validation happens
 * inside KnowledgeBus.publish — LanceDB itself stores any string.
 */
export const ALLOWED_MESSAGE_TYPES = [
  "decision",
  "fact",
  "requirement",
  "artifact",
  "diary",
  "finding",
  "pattern",
  "lesson",
] as const;

export type MessageType = (typeof ALLOWED_MESSAGE_TYPES)[number];
