#!/usr/bin/env tsx
/**
 * mempalace-recall.ts – Reads the memory_recall pattern's JSON output,
 * executes the planned mempalace_search queries via MCP, and writes a
 * filled Markdown context_block that downstream LLM steps consume as
 * their input.
 *
 * Usage: tsx tools/mempalace-recall.ts <input-file> <output-file>
 *
 * Input: memory_store pattern output – typically ContextBuilder-wrapped
 *        markdown containing JSON with `search_queries[]`.
 * Output: A Markdown file structured into four sections
 *         (Bekannte Entscheidungen / Constraints & Fakten / Bekannte
 *         Risiken & Findings / Patterns & Lessons Learned). Each section
 *         is populated from the search results grouped by drawer metadata.type.
 *
 * Counterpart to mempalace-persist.ts for the read path. Shares the JSON
 * extraction and config loading helpers so both paths follow the exact
 * same `mcp.servers.mempalace` configuration.
 *
 * Fire-and-forget: This script NEVER exits non-zero. MemPalace unreachable,
 * missing queries, malformed input – all are logged to stderr and reported
 * in the output file with a "skipped" note. The AIOS workflow continues.
 *
 * The engine (src/core/engine.ts) reads $OUTPUT back into the step message
 * content because `memory_recall_fetch` declares `output_type: text`.
 * Downstream LLM steps see the filled Markdown as their input_from payload.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, normalize } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  findFirstJsonObject,
  loadMempalaceConfig,
  type MempalaceCmd,
} from "./mempalace-persist.js";

// ─── Types ─────────────────────────────────────────────────

type MemoryType = "decision" | "fact" | "finding" | "pattern" | "lesson";

export interface SearchQuery {
  query: string;
  wing?: string;
  room?: string;
  rationale?: string;
}

export interface RecallPlan {
  search_queries: SearchQuery[];
}

export interface Drawer {
  content: string;
  wing?: string;
  room?: string;
  type?: MemoryType;
  relevance?: string;
  score?: number;
}

export interface RecallResult {
  sections: Record<SectionKey, Drawer[]>;
  total_queries: number;
  total_hits: number;
  skipped_reason?: string;
}

type SectionKey = "decisions" | "facts" | "findings" | "patterns_lessons";

const SECTION_TITLES: Record<SectionKey, string> = {
  decisions: "Bekannte Entscheidungen",
  facts: "Constraints & Fakten",
  findings: "Bekannte Risiken & Findings",
  patterns_lessons: "Patterns & Lessons Learned",
};

const TYPE_TO_SECTION: Record<MemoryType, SectionKey> = {
  decision: "decisions",
  fact: "facts",
  finding: "findings",
  pattern: "patterns_lessons",
  lesson: "patterns_lessons",
};

const DEFAULT_SECTION: SectionKey = "facts";

// ─── Input parsing ─────────────────────────────────────────

function isSearchQuery(x: unknown): x is SearchQuery {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  return typeof obj.query === "string" && obj.query.trim().length > 0;
}

/**
 * Extract the RecallPlan from memory_recall's JSON output.
 * Robust to ContextBuilder markdown wrapping and code fences.
 */
export function extractRecallPlan(input: string): RecallPlan {
  const json = findFirstJsonObject(input);
  if (!json) throw new Error("kein JSON-Objekt im Input gefunden");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`JSON-Parsing fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Top-Level ist kein Objekt");
  }
  const obj = parsed as Record<string, unknown>;
  const queriesRaw = obj.search_queries;
  if (!Array.isArray(queriesRaw)) {
    throw new Error("Feld search_queries fehlt oder ist kein Array");
  }
  const queries: SearchQuery[] = [];
  for (const raw of queriesRaw) {
    if (!isSearchQuery(raw)) continue;
    const q = raw as Record<string, unknown>;
    queries.push({
      query: (q.query as string).trim(),
      wing: typeof q.wing === "string" && q.wing.trim() ? q.wing.trim() : undefined,
      room: typeof q.room === "string" && q.room.trim() ? q.room.trim() : undefined,
      rationale: typeof q.rationale === "string" ? q.rationale : undefined,
    });
  }
  return { search_queries: queries };
}

// ─── MCP response parsing ──────────────────────────────────

/**
 * Parse a mempalace_search response into a list of drawers.
 * Handles several response shapes (JSON array, {results|drawers|items},
 * newline-delimited text) because MemPalace tool responses may vary
 * between versions.
 */
export function parseSearchResponse(response: unknown): Drawer[] {
  if (!response || typeof response !== "object") return [];
  const content = (response as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return [];
  const joined = content
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
  if (!joined.trim()) return [];

  // Try JSON first
  try {
    const parsed: unknown = JSON.parse(joined);
    return normalizeDrawers(parsed);
  } catch {
    // Non-JSON fallback: treat each non-empty line as a drawer content
    return joined
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => ({ content: l }));
  }
}

function normalizeDrawers(parsed: unknown): Drawer[] {
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeDrawer).filter((d): d is Drawer => d !== null);
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    // Common container field names
    for (const key of ["results", "drawers", "items", "matches", "hits"]) {
      const val = obj[key];
      if (Array.isArray(val)) {
        return val.map(normalizeDrawer).filter((d): d is Drawer => d !== null);
      }
    }
    // Single drawer object
    const single = normalizeDrawer(parsed);
    return single ? [single] : [];
  }
  return [];
}

function normalizeDrawer(raw: unknown): Drawer | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // content can live in content / text / drawer / value
  const content =
    typeof obj.content === "string" ? obj.content :
    typeof obj.text === "string" ? obj.text :
    typeof obj.drawer === "string" ? obj.drawer :
    typeof obj.value === "string" ? obj.value :
    "";
  if (!content.trim()) return null;

  // Metadata may be nested under metadata or flat
  const metadata = (obj.metadata && typeof obj.metadata === "object")
    ? obj.metadata as Record<string, unknown>
    : obj;

  const type = metadata.type;
  const validType: MemoryType | undefined =
    type === "decision" || type === "fact" || type === "finding" ||
    type === "pattern" || type === "lesson" ? type : undefined;

  const score = typeof obj.score === "number" ? obj.score
    : typeof obj.similarity === "number" ? obj.similarity
    : undefined;

  return {
    content: content.trim(),
    wing: typeof obj.wing === "string" ? obj.wing : typeof metadata.wing === "string" ? metadata.wing : undefined,
    room: typeof obj.room === "string" ? obj.room : typeof metadata.room === "string" ? metadata.room : undefined,
    type: validType,
    relevance: typeof metadata.relevance === "string" ? metadata.relevance : undefined,
    score,
  };
}

// ─── Grouping & deduplication ──────────────────────────────

function dedupDrawers(drawers: Drawer[]): Drawer[] {
  const seen = new Set<string>();
  const out: Drawer[] = [];
  for (const d of drawers) {
    const key = d.content.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export function groupDrawers(drawers: Drawer[]): Record<SectionKey, Drawer[]> {
  const sections: Record<SectionKey, Drawer[]> = {
    decisions: [],
    facts: [],
    findings: [],
    patterns_lessons: [],
  };
  for (const d of dedupDrawers(drawers)) {
    const section = d.type ? TYPE_TO_SECTION[d.type] : DEFAULT_SECTION;
    sections[section].push(d);
  }
  return sections;
}

// ─── Search execution ──────────────────────────────────────

const MAX_QUERIES = 4;
const MAX_HITS_PER_QUERY = 5;
const MAX_TOTAL_HITS = 20;

async function runSearches(queries: SearchQuery[], cmd: MempalaceCmd): Promise<RecallResult> {
  const result: RecallResult = {
    sections: { decisions: [], facts: [], findings: [], patterns_lessons: [] },
    total_queries: 0,
    total_hits: 0,
  };

  if (queries.length === 0) {
    result.skipped_reason = "keine search_queries im Input";
    return result;
  }

  const cappedQueries = queries.slice(0, MAX_QUERIES);

  // Strip sensitive env keys (same list as McpManager / mempalace-persist).
  const SENSITIVE = [
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_API_KEY",
    "AWS_SECRET_ACCESS_KEY", "AZURE_CLIENT_SECRET",
    "GH_TOKEN", "GITHUB_TOKEN", "NPM_TOKEN",
  ];
  const baseEnv: Record<string, string> = Object.fromEntries(
    Object.entries(process.env)
      .filter(([k, v]) => typeof v === "string" && !SENSITIVE.includes(k)),
  ) as Record<string, string>;
  const childEnv = cmd.env ? { ...baseEnv, ...cmd.env } : baseEnv;

  const transport = new StdioClientTransport({
    command: cmd.command,
    args: cmd.args,
    env: childEnv,
  });
  const client = new Client({ name: "aios-mempalace-recall", version: "0.1.0" });

  try {
    await client.connect(transport);
  } catch (e) {
    result.skipped_reason = `MemPalace nicht erreichbar: ${e instanceof Error ? e.message : String(e)}`;
    try { await transport.close(); } catch { /* ignore */ }
    return result;
  }

  const allDrawers: Drawer[] = [];
  try {
    for (const q of cappedQueries) {
      result.total_queries++;
      try {
        const args: Record<string, unknown> = {
          query: q.query,
          top_k: MAX_HITS_PER_QUERY,
          limit: MAX_HITS_PER_QUERY,
        };
        if (q.wing) args.wing = q.wing;
        if (q.room) args.room = q.room;
        const res = await client.callTool({
          name: "mempalace_search",
          arguments: args,
        });
        const drawers = parseSearchResponse(res).slice(0, MAX_HITS_PER_QUERY);
        allDrawers.push(...drawers);
        if (allDrawers.length >= MAX_TOTAL_HITS) break;
      } catch (e) {
        console.error(`mempalace-recall: query "${q.query}" failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    try { await transport.close(); } catch { /* ignore */ }
  }

  const capped = allDrawers.slice(0, MAX_TOTAL_HITS);
  result.sections = groupDrawers(capped);
  result.total_hits = capped.length;
  return result;
}

// ─── Markdown formatting ───────────────────────────────────

function formatDrawerLine(d: Drawer): string {
  const loc = d.wing && d.room ? ` _(${d.wing}/${d.room})_` : d.wing ? ` _(${d.wing})_` : "";
  return `- ${d.content}${loc}`;
}

export function formatContextBlock(result: RecallResult, queries: SearchQuery[]): string {
  const lines: string[] = ["# Relevanter Kontext aus MemPalace", ""];

  if (result.skipped_reason) {
    lines.push(`> _Kein Kontext verfügbar: ${result.skipped_reason}_`, "");
  } else if (result.total_hits === 0) {
    lines.push(
      `> _Keine relevanten Treffer für ${result.total_queries} Suchanfrage(n)._`,
      "",
    );
  } else {
    lines.push(
      `> ${result.total_hits} Treffer aus ${result.total_queries} Suchanfrage(n).`,
      "",
    );
  }

  for (const key of ["decisions", "facts", "findings", "patterns_lessons"] as SectionKey[]) {
    lines.push(`## ${SECTION_TITLES[key]}`);
    lines.push("");
    const drawers = result.sections[key];
    if (drawers.length === 0) {
      lines.push("_Keine Einträge._");
    } else {
      for (const d of drawers) lines.push(formatDrawerLine(d));
    }
    lines.push("");
  }

  if (queries.length > 0) {
    lines.push("---", "", "_Suchanfragen:_");
    for (const q of queries.slice(0, MAX_QUERIES)) {
      const filter = q.wing ? ` [${q.wing}${q.room ? "/" + q.room : ""}]` : "";
      lines.push(`- \`${q.query}\`${filter}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3];

  if (!inputFile || !outputFile) {
    console.error("Usage: mempalace-recall.ts <input-file> <output-file>");
    if (outputFile) {
      writeFileSync(outputFile, "# Relevanter Kontext aus MemPalace\n\n_Kein Kontext verfügbar: missing arguments._\n");
    }
    process.exit(0);
  }

  let plan: RecallPlan;
  try {
    const raw = readFileSync(resolve(normalize(inputFile)), "utf-8");
    plan = extractRecallPlan(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`mempalace-recall: Input-Parsing gescheitert: ${msg}`);
    const fallback = formatContextBlock(
      {
        sections: { decisions: [], facts: [], findings: [], patterns_lessons: [] },
        total_queries: 0,
        total_hits: 0,
        skipped_reason: `Input-Parsing gescheitert: ${msg}`,
      },
      [],
    );
    writeFileSync(outputFile, fallback);
    process.exit(0);
  }

  const cmd = loadMempalaceConfig(process.cwd());
  const result = await runSearches(plan.search_queries, cmd);
  const markdown = formatContextBlock(result, plan.search_queries);
  writeFileSync(outputFile, markdown);

  console.error(
    `mempalace-recall: queries=${result.total_queries} hits=${result.total_hits}` +
      (result.skipped_reason ? ` skipped="${result.skipped_reason}"` : ""),
  );
  process.exit(0);
}

const isMain = (() => {
  try {
    const invoked = process.argv[1] ? resolve(normalize(process.argv[1])) : "";
    const self = new URL(import.meta.url).pathname;
    return invoked && (invoked === self || invoked.endsWith("mempalace-recall.ts"));
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((e) => {
    console.error(`mempalace-recall: unhandled error: ${e instanceof Error ? e.message : e}`);
    process.exit(0);
  });
}
