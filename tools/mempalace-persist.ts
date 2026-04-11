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

/**
 * A memory item carries either a pre-resolved `wing` name (power-user
 * override) or a semantic `category` which the tool script resolves to
 * a wing via the per-context mapping in `.aios/context.yaml`. At least
 * one of the two must be set; if both are present, `wing` wins.
 */
export interface MemoryItem {
  wing?: string;
  category?: string;
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
  wing_source?: "context.yaml" | "defaults";
  wing_context_path?: string;
}

export interface MempalaceCmd {
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
  const category = typeof obj.category === "string" ? obj.category.trim() : "";
  const room = typeof obj.room === "string" ? obj.room.trim() : "";
  const content = typeof obj.content === "string" ? obj.content.trim() : "";
  const type = obj.type;
  if (!wing && !category) {
    throw new Error("memory_item: wing oder category muss gesetzt sein");
  }
  if (!room) throw new Error("memory_item: room fehlt oder leer");
  if (!content) throw new Error("memory_item: content fehlt oder leer");
  if (!isMemoryType(type)) throw new Error(`memory_item: ungültiger type "${String(type)}"`);

  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === "string")
    : undefined;
  const relevance = isRelevance(obj.relevance) ? obj.relevance : undefined;

  return {
    wing: wing || undefined,
    category: category || undefined,
    room,
    content,
    type,
    relevance,
    tags,
  };
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

// ─── Wing Resolution (context.yaml memory.wings) ──────────

/**
 * Default wing names used when no context.yaml override is present.
 * Keep in sync with docs/MEMPALACE_INTEGRATION.md Wing-Mapping section.
 */
export const DEFAULT_WINGS: Record<string, string> = {
  decisions: "wing_aios_decisions",
  facts: "wing_aios",
  findings: "wing_aios_findings",
  patterns: "wing_aios_patterns",
  lessons: "wing_aios_patterns",
  compliance: "wing_aios_compliance",
  default: "wing_aios",
};

export interface WingConfig {
  wings: Record<string, string>;
  source: "context.yaml" | "defaults";
  contextPath?: string;
}

/**
 * Walk upward from `start` looking for `.aios/context.yaml` (up to 6 parent
 * levels). Returns the absolute path or null. Tool scripts run in the same
 * CWD as the AIOS process, so the same context applies.
 */
function findContextYaml(start: string): string | null {
  let dir = resolve(normalize(start));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".aios", "context.yaml");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Load the `memory.wings` mapping from the active context's context.yaml.
 * Returns an empty map (and source="defaults") when no file is found or
 * the file lacks a memory.wings section. Malformed YAML is silently
 * ignored — tool scripts must never crash the workflow over config.
 */
export function loadWingConfig(cwd: string): WingConfig {
  const contextPath = findContextYaml(cwd);
  if (!contextPath) return { wings: {}, source: "defaults" };
  try {
    const raw = readFileSync(contextPath, "utf-8");
    const doc = YAML.parse(raw) as unknown;
    if (!doc || typeof doc !== "object") return { wings: {}, source: "defaults" };
    const memory = (doc as { memory?: unknown }).memory;
    if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
      return { wings: {}, source: "defaults", contextPath };
    }
    const wingsRaw = (memory as { wings?: unknown }).wings;
    if (!wingsRaw || typeof wingsRaw !== "object" || Array.isArray(wingsRaw)) {
      return { wings: {}, source: "defaults", contextPath };
    }
    const wings: Record<string, string> = {};
    for (const [k, v] of Object.entries(wingsRaw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) {
        wings[k.trim().toLowerCase()] = v.trim();
      }
    }
    return {
      wings,
      source: Object.keys(wings).length > 0 ? "context.yaml" : "defaults",
      contextPath,
    };
  } catch {
    return { wings: {}, source: "defaults", contextPath };
  }
}

/**
 * Resolve a semantic category to a MemPalace wing name.
 *
 * Precedence:
 *   1. Explicit full `wing_*` name passed as category → used verbatim
 *      (power-user / legacy prompt escape hatch)
 *   2. Per-context override from context.yaml `memory.wings`
 *   3. Built-in DEFAULT_WINGS map
 *   4. DEFAULT_WINGS.default as final fallback
 */
export function resolveWing(category: string, cfg: WingConfig): string {
  const raw = category.trim();
  if (!raw) return cfg.wings.default ?? DEFAULT_WINGS.default;
  if (raw.startsWith("wing_")) return raw;
  const key = raw.toLowerCase();
  if (cfg.wings[key]) return cfg.wings[key];
  if (DEFAULT_WINGS[key]) return DEFAULT_WINGS[key];
  return cfg.wings.default ?? DEFAULT_WINGS.default;
}

/**
 * Resolve a memory item to its final wing.
 * Explicit `item.wing` takes precedence over `item.category`.
 */
export function resolveItemWing(item: MemoryItem, cfg: WingConfig): string {
  if (item.wing && item.wing.trim()) return item.wing.trim();
  if (item.category && item.category.trim()) return resolveWing(item.category, cfg);
  return cfg.wings.default ?? DEFAULT_WINGS.default;
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

async function persistItems(
  items: MemoryItem[],
  cmd: MempalaceCmd,
  wingCfg: WingConfig,
): Promise<PersistResult> {
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
        // Resolve the final wing from context.yaml overrides or defaults.
        // Explicit item.wing wins; otherwise item.category is looked up.
        const wing = resolveItemWing(item, wingCfg);

        const dupRes = await client.callTool({
          name: "mempalace_check_duplicate",
          arguments: {
            wing,
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
            wing,
            room: item.room,
            content: item.content,
            metadata: {
              type: item.type,
              relevance: item.relevance ?? "medium",
              tags: item.tags ?? [],
              source: "aios:memory_store",
              category: item.category ?? null,
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
  if (result.wing_source) {
    const srcDesc = result.wing_source === "context.yaml"
      ? `context.yaml (${result.wing_context_path ?? "unknown"})`
      : "built-in defaults";
    lines.push(`- Wing mapping: ${srcDesc}`);
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
  const wingCfg = loadWingConfig(process.cwd());
  const result = await persistItems(items, cmd, wingCfg);
  result.wing_source = wingCfg.source;
  result.wing_context_path = wingCfg.contextPath;

  writeFileSync(outputFile, formatSummary(result));
  console.error(
    `mempalace-persist: stored=${result.stored} duplicates=${result.duplicates} ` +
      `failed=${result.failed} total=${result.total} wings=${wingCfg.source}` +
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
