import { existsSync, readFileSync } from "fs";
import { join, normalize, resolve } from "path";
import * as YAML from "yaml";

/**
 * Wing-Resolver — translates semantic category names ("decisions",
 * "facts", "findings", …) into concrete wing names ("wing_aios_decisions",
 * "wing_myproject_adrs", …).
 *
 * Wings are top-level knowledge buckets, Rooms are sub-topics within
 * them. The two-level hierarchy lets multiple contexts share the same
 * abstract categories ("decisions", "findings") while keeping their
 * concrete buckets isolated by name. The LLM emits abstract categories
 * and the resolver translates them to context-specific wing names via
 * the active `.aios/context.yaml` `memory.wings` block.
 */

/**
 * Default wing names used when no context.yaml override is present.
 * Keep in sync with docs/KNOWLEDGE_BUS.md Wing-Mapping section.
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
 * Walk upward from `start` looking for `.aios/context.yaml` (up to 6
 * parent levels). Returns the absolute path or null. Same six-level
 * window as the old tool script so existing project layouts continue
 * to work without changes.
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
 * Load the `memory.wings` mapping from the active context's
 * context.yaml. Returns an empty map (and source="defaults") when no
 * file is found or the file lacks a memory.wings section. Malformed
 * YAML is silently ignored — wing resolution must never crash a
 * workflow over config issues.
 */
export function loadWingConfig(cwd: string = process.cwd()): WingConfig {
  const contextPath = findContextYaml(cwd);
  if (!contextPath) return { wings: {}, source: "defaults" };
  try {
    const raw = readFileSync(contextPath, "utf-8");
    const doc = YAML.parse(raw) as unknown;
    if (!doc || typeof doc !== "object") {
      return { wings: {}, source: "defaults" };
    }
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
 * Resolve a semantic category to a concrete wing name.
 *
 * Precedence (matches the legacy tool-script behavior):
 *   1. Explicit full `wing_*` name passed as category → used verbatim
 *      (escape-hatch for legacy data with hard-coded wings)
 *   2. Per-context override from context.yaml `memory.wings`
 *   3. Built-in DEFAULT_WINGS map
 *   4. DEFAULT_WINGS.default as final fallback
 */
export function resolveWing(category: string, cfg?: WingConfig): string {
  const config = cfg ?? loadWingConfig();
  const raw = (category ?? "").trim();
  if (!raw) return config.wings.default ?? DEFAULT_WINGS.default;
  if (raw.startsWith("wing_")) return raw;
  const key = raw.toLowerCase();
  if (config.wings[key]) return config.wings[key];
  if (DEFAULT_WINGS[key]) return DEFAULT_WINGS[key];
  return config.wings.default ?? DEFAULT_WINGS.default;
}

/**
 * Resolve a memory item with explicit-wing precedence.
 * Used by the memory_store pattern executor when persisting items
 * that may carry an explicit wing override.
 */
export interface MemoryItemLike {
  wing?: string;
  category?: string;
}

export function resolveItemWing(item: MemoryItemLike, cfg?: WingConfig): string {
  const config = cfg ?? loadWingConfig();
  if (item.wing && item.wing.trim()) {
    return item.wing.trim();
  }
  if (item.category && item.category.trim()) {
    return resolveWing(item.category, config);
  }
  return config.wings.default ?? DEFAULT_WINGS.default;
}
