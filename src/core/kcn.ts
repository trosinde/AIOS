/**
 * Knowledge Compact Notation (KCN) — a token-efficient text format
 * for memory items, used both for storage and for LLM context
 * injection.
 *
 * Why this exists: when memory_recall returns 5-10 items to the next
 * workflow step, every byte costs LLM input tokens. JSON wrappers add
 * ~30 tokens of overhead per item (`{"type":"...","wing":"...",...}`).
 * Markdown headers add ~15. KCN adds ~5-8. For a typical recall block
 * with 10 items this saves 200-300 tokens — and over a 30-step
 * workflow that's 6,000-9,000 tokens.
 *
 * Format
 * ──────
 * Each item is two parts:
 *
 *   [<type>|<wing>|<room>|<tag>,<tag>]
 *   <content body, may span lines, no leading [>
 *
 * Multiple items are separated by `~~~` on its own line.
 *
 *   [D|wing_aios_decisions|kernel_abi|abi,stable]
 *   LanceDB chosen as KB backend because HNSW + columnar metadata
 *   in single embedded process delivers in-process latency.
 *   ~~~
 *   [F|wing_aios|embeddings]
 *   nomic-embed-text emits 768-dim float32 vectors.
 *
 * Type abbreviations
 * ──────────────────
 *   D = decision   F = fact     R = requirement   A = artifact
 *   P = pattern    L = lesson   X = finding       J = diary
 *
 * Empty fields are omitted; the parser handles missing positions.
 * Pipes inside content are not escaped (they're allowed in the body)
 * — only the first line containing exactly `[...]` matters as header.
 * The header must start with `[` and end with `]`. Anything else is
 * treated as body.
 */

import type { KernelMessage, KnowledgeType } from "../types.js";

const TYPE_ABBREV: Record<string, string> = {
  decision: "D",
  fact: "F",
  requirement: "R",
  artifact: "A",
  pattern: "P",
  lesson: "L",
  finding: "X",
  diary: "J",
};

const ABBREV_TYPE: Record<string, KnowledgeType> = {
  D: "decision",
  F: "fact",
  R: "requirement",
  A: "artifact",
  P: "pattern",
  L: "lesson",
  X: "finding",
  J: "diary",
};

export interface KcnItem {
  type: KnowledgeType;
  wing?: string;
  room?: string;
  tags?: string[];
  content: string;
}

const ITEM_SEPARATOR = "~~~";

/**
 * Encode a single item into KCN form. Returns a string with the
 * header on line 1 and the body following. No trailing separator.
 */
export function encodeItem(item: KcnItem): string {
  const t = TYPE_ABBREV[item.type] ?? "F";
  const wing = item.wing ?? "";
  const room = item.room ?? "";
  const tagStr = item.tags && item.tags.length > 0 ? item.tags.join(",") : "";
  // Drop trailing empty fields for compactness.
  const fields = [t, wing, room, tagStr];
  while (fields.length > 1 && fields[fields.length - 1] === "") {
    fields.pop();
  }
  const header = `[${fields.join("|")}]`;
  return `${header}\n${item.content}`;
}

/**
 * Encode many items separated by ITEM_SEPARATOR.
 */
export function encodeItems(items: KcnItem[]): string {
  if (items.length === 0) return "";
  return items.map(encodeItem).join(`\n${ITEM_SEPARATOR}\n`);
}

/**
 * Convert a KernelMessage row from the KB into a KcnItem.
 */
export function messageToItem(msg: KernelMessage): KcnItem {
  return {
    type: msg.type,
    wing: msg.wing,
    room: msg.room,
    tags: msg.tags,
    content: msg.content,
  };
}

/**
 * Encode a list of KernelMessages — convenience for the recall path.
 */
export function encodeMessages(messages: KernelMessage[]): string {
  return encodeItems(messages.map(messageToItem));
}

/**
 * Parse a single KCN item from text. Returns null on malformed input.
 */
export function decodeItem(text: string): KcnItem | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const newlineIdx = trimmed.indexOf("\n");
  const headerLine = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx);
  const body = newlineIdx === -1 ? "" : trimmed.slice(newlineIdx + 1);

  if (!headerLine.startsWith("[") || !headerLine.endsWith("]")) {
    // No valid header — treat the whole thing as a content-only fact item.
    return { type: "fact", content: trimmed };
  }
  const inner = headerLine.slice(1, -1);
  const parts = inner.split("|");
  const typeAbbrev = (parts[0] ?? "F").toUpperCase();
  const type = ABBREV_TYPE[typeAbbrev] ?? "fact";
  const wing = parts[1] || undefined;
  const room = parts[2] || undefined;
  const tags = parts[3]
    ? parts[3]
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : undefined;

  return { type, wing, room, tags, content: body };
}

/**
 * Parse multiple items separated by `~~~` lines.
 */
export function decodeItems(text: string): KcnItem[] {
  if (!text.trim()) return [];
  const blocks = text.split(new RegExp(`^${ITEM_SEPARATOR}$`, "m"));
  const out: KcnItem[] = [];
  for (const block of blocks) {
    const item = decodeItem(block);
    if (item) out.push(item);
  }
  return out;
}

/**
 * Estimate token count for a KCN-encoded string. Uses a rough
 * heuristic (~4 chars/token for English/German) — good enough for
 * benchmarking compression ratio against JSON/markdown alternatives.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format the same set of messages as a JSON-array — used to compare
 * the token cost of KCN vs the naive JSON approach in benchmarks.
 */
export function encodeAsJson(messages: KernelMessage[]): string {
  return JSON.stringify(
    messages.map((m) => ({
      type: m.type,
      wing: m.wing,
      room: m.room,
      tags: m.tags,
      content: m.content,
    })),
  );
}

/**
 * Format the same set of messages as a Markdown block — the legacy
 * format used by the recall executor before KCN was introduced.
 */
export function encodeAsMarkdown(messages: KernelMessage[]): string {
  return messages
    .map((m) => {
      const meta: string[] = [];
      if (m.type) meta.push(m.type);
      if (m.wing) meta.push(`wing: ${m.wing}`);
      if (m.room) meta.push(`room: ${m.room}`);
      if (m.tags?.length) meta.push(`tags: ${m.tags.join(", ")}`);
      const header = meta.length > 0 ? `**${meta.join(" · ")}**\n\n` : "";
      return `### Item\n\n${header}${m.content}\n`;
    })
    .join("\n---\n\n");
}
