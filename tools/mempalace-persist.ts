#!/usr/bin/env tsx
/**
 * mempalace-persist.ts – Persists memory_items from the memory_store pattern
 * to a MemPalace MCP server.
 *
 * Usage: tsx tools/mempalace-persist.ts <input-file> <output-file>
 *
 * Input: A text file containing the memory_store pattern output. The file
 *        may contain markdown wrapping (ContextBuilder headers, code fences);
 *        this tool extracts the first balanced JSON object with a
 *        `memory_items` array.
 *
 * Output: A human-readable summary (Markdown) of how many items were stored,
 *         skipped as duplicates, or failed. The same numbers go to stderr
 *         as a one-line status.
 *
 * Fire-and-forget: This script NEVER exits non-zero. MemPalace unreachable,
 * missing items, malformed input – all are logged and reported in the summary
 * with exit code 0 so the AIOS workflow is not broken.
 *
 * Configuration: Reads `mcp.servers.mempalace` from `./aios.yaml` to pick up
 * the same command/args/env the running McpManager uses. Falls back to
 * `python -m mempalace.mcp_server`.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, normalize, join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import YAML from "yaml";

// ─── Types ─────────────────────────────────────────────────

export type MemoryType = "decision" | "fact" | "finding" | "pattern" | "lesson";
export type Relevance = "high" | "medium" | "low";

export interface MemoryItem {
  wing: string;
  room: string;
  content: string;
  type: MemoryType;
  relevance?: Relevance;
  tags?: string[];
}

export interface PersistResult {
  stored: number;
  duplicates: number;
  failed: number;
  total: number;
  skipped_reason?: string;
  errors: string[];
}

interface MempalaceCmd {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// ─── JSON extraction ───────────────────────────────────────

/**
 * Extract the first balanced top-level JSON object from an arbitrary string.
 * Handles markdown code fences, ContextBuilder wrapping, leading prose, etc.
 * Returns null if no complete JSON object is found.
 */
export function findFirstJsonObject(input: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

function isMemoryType(x: unknown): x is MemoryType {
  return x === "decision" || x === "fact" || x === "finding" || x === "pattern" || x === "lesson";
}

function isRelevance(x: unknown): x is Relevance {
  return x === "high" || x === "medium" || x === "low";
}

function validateItem(raw: unknown): MemoryItem {
  if (!raw || typeof raw !== "object") {
    throw new Error("memory_item ist kein Objekt");
  }
  const obj = raw as Record<string, unknown>;
  const wing = typeof obj.wing === "string" ? obj.wing.trim() : "";
  const room = typeof obj.room === "string" ? obj.room.trim() : "";
  const content = typeof obj.content === "string" ? obj.content.trim() : "";
  const type = obj.type;
  if (!wing) throw new Error("memory_item: wing fehlt oder leer");
  if (!room) throw new Error("memory_item: room fehlt oder leer");
  if (!content) throw new Error("memory_item: content fehlt oder leer");
  if (!isMemoryType(type)) throw new Error(`memory_item: ungültiger type "${String(type)}"`);

  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === "string")
    : undefined;
  const relevance = isRelevance(obj.relevance) ? obj.relevance : undefined;

  return { wing, room, content, type, relevance, tags };
}

/**
 * Parse the memory_store pattern output and return a validated list of items.
 * Throws on malformed input.
 */
export function extractMemoryItems(input: string): MemoryItem[] {
  const json = findFirstJsonObject(input);
  if (!json) {
    throw new Error("kein JSON-Objekt im Input gefunden");
  }
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
  const items = obj.memory_items;
  if (!Array.isArray(items)) {
    throw new Error("Feld memory_items fehlt oder ist kein Array");
  }
  return items.map(validateItem);
}

// ─── MemPalace config loading ──────────────────────────────

const DEFAULT_CMD: MempalaceCmd = {
  command: "python",
  args: ["-m", "mempalace.mcp_server"],
};

/**
 * Load the mempalace MCP command from aios.yaml, with defaults.
 * Only reads `mcp.servers.mempalace.{command,args,env}`.
 */
export function loadMempalaceConfig(cwd: string): MempalaceCmd {
  const yamlPath = join(cwd, "aios.yaml");
  if (!existsSync(yamlPath)) return DEFAULT_CMD;
  try {
    const raw = readFileSync(yamlPath, "utf-8");
    const doc = YAML.parse(raw) as unknown;
    if (!doc || typeof doc !== "object") return DEFAULT_CMD;
    const mcp = (doc as { mcp?: { servers?: Record<string, unknown> } }).mcp;
    const cfg = mcp?.servers?.mempalace;
    if (!cfg || typeof cfg !== "object") return DEFAULT_CMD;
    const c = cfg as { command?: unknown; args?: unknown; env?: unknown };
    if (typeof c.command !== "string") return DEFAULT_CMD;
    const args = Array.isArray(c.args) ? c.args.filter((a): a is string => typeof a === "string") : [];
    const env = c.env && typeof c.env === "object" && !Array.isArray(c.env)
      ? Object.fromEntries(
          Object.entries(c.env as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string")
            .map(([k, v]) => [k, v as string]),
        )
      : undefined;
    return { command: c.command, args, env };
  } catch {
    return DEFAULT_CMD;
  }
}

// ─── MCP response parsing ──────────────────────────────────

/**
 * Best-effort interpretation of a mempalace_check_duplicate response.
 * Mempalace response shapes vary between versions; we look for
 * common boolean flags and fall back to textual hints.
 */
export function parseDuplicateResponse(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const content = (response as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return false;
  const joined = content
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
  if (!joined) return false;
  try {
    const parsed: unknown = JSON.parse(joined);
    if (typeof parsed === "boolean") return parsed;
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      if (typeof rec.duplicate === "boolean") return rec.duplicate;
      if (typeof rec.is_duplicate === "boolean") return rec.is_duplicate;
      if (typeof rec.exists === "boolean") return rec.exists;
      if (typeof rec.found === "boolean") return rec.found;
    }
  } catch {
    // Non-JSON text: conservative check.
  }
  return /\bduplicate\b|\balready exists\b/i.test(joined);
}

// ─── Persistence loop ──────────────────────────────────────

async function persistItems(items: MemoryItem[], cmd: MempalaceCmd): Promise<PersistResult> {
  const result: PersistResult = {
    stored: 0,
    duplicates: 0,
    failed: 0,
    total: items.length,
    errors: [],
  };
  if (items.length === 0) {
    result.skipped_reason = "keine memory_items im Input";
    return result;
  }

  // Strip sensitive env keys before forwarding (defense-in-depth, same
  // convention as McpManager in src/core/mcp.ts).
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
  const client = new Client({ name: "aios-mempalace-persist", version: "0.1.0" });

  try {
    await client.connect(transport);
  } catch (e) {
    result.skipped_reason = `MemPalace nicht erreichbar: ${e instanceof Error ? e.message : String(e)}`;
    try { await transport.close(); } catch { /* ignore */ }
    return result;
  }

  try {
    for (const item of items) {
      try {
        const dupRes = await client.callTool({
          name: "mempalace_check_duplicate",
          arguments: {
            wing: item.wing,
            room: item.room,
            content: item.content,
          },
        });
        if (parseDuplicateResponse(dupRes)) {
          result.duplicates++;
          continue;
        }

        await client.callTool({
          name: "mempalace_add_drawer",
          arguments: {
            wing: item.wing,
            room: item.room,
            content: item.content,
            metadata: {
              type: item.type,
              relevance: item.relevance ?? "medium",
              tags: item.tags ?? [],
              source: "aios:memory_store",
            },
          },
        });
        result.stored++;
      } catch (e) {
        result.failed++;
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  } finally {
    try { await transport.close(); } catch { /* ignore */ }
  }
  return result;
}

// ─── Output formatting ─────────────────────────────────────

export function formatSummary(result: PersistResult): string {
  const lines: string[] = [
    "# MemPalace Persist – Summary",
    "",
    `- Total items:  ${result.total}`,
    `- Stored:       ${result.stored}`,
    `- Duplicates:   ${result.duplicates}`,
    `- Failed:       ${result.failed}`,
  ];
  if (result.skipped_reason) {
    lines.push(`- Skipped:      ${result.skipped_reason}`);
  }
  if (result.errors.length > 0) {
    lines.push("", "## Errors", ...result.errors.slice(0, 10).map((e) => `- ${e}`));
    if (result.errors.length > 10) {
      lines.push(`- … (${result.errors.length - 10} weitere unterdrückt)`);
    }
  }
  return lines.join("\n") + "\n";
}

// ─── Main entry point ──────────────────────────────────────

async function main(): Promise<void> {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3];

  if (!inputFile || !outputFile) {
    console.error("Usage: mempalace-persist.ts <input-file> <output-file>");
    if (outputFile) {
      writeFileSync(outputFile, "# MemPalace Persist – Summary\n\nStatus: missing arguments\n");
    }
    process.exit(0);
  }

  let items: MemoryItem[] = [];
  try {
    const raw = readFileSync(resolve(normalize(inputFile)), "utf-8");
    items = extractMemoryItems(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`mempalace-persist: Input-Parsing gescheitert: ${msg}`);
    writeFileSync(outputFile, formatSummary({
      stored: 0, duplicates: 0, failed: 0, total: 0,
      skipped_reason: `Input-Parsing gescheitert: ${msg}`,
      errors: [],
    }));
    process.exit(0);
  }

  const cmd = loadMempalaceConfig(process.cwd());
  const result = await persistItems(items, cmd);

  writeFileSync(outputFile, formatSummary(result));
  console.error(
    `mempalace-persist: stored=${result.stored} duplicates=${result.duplicates} ` +
      `failed=${result.failed} total=${result.total}` +
      (result.skipped_reason ? ` skipped="${result.skipped_reason}"` : ""),
  );
  process.exit(0);
}

// Only run main() when executed as a script, not when imported for tests.
// The tsx loader sets import.meta.url to the file URL.
const isMain = (() => {
  try {
    const invoked = process.argv[1] ? resolve(normalize(process.argv[1])) : "";
    const self = new URL(import.meta.url).pathname;
    return invoked && (invoked === self || invoked.endsWith("mempalace-persist.ts"));
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((e) => {
    console.error(`mempalace-persist: unhandled error: ${e instanceof Error ? e.message : e}`);
    process.exit(0);
  });
}
