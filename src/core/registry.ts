import { readFileSync, readdirSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import matter from "gray-matter";
import type { Pattern, PatternMeta, PatternParameter } from "../types.js";
import { validateOutputExtraction } from "./output-extractor.js";

/**
 * Kernel ABI version supported by this kernel.
 *
 * - v1: baseline (kernel_abi, name, input_type, output_type, persona, ...)
 * - v2: adds `requires` (TaskRequirements for capability-based provider selection)
 *
 * Patterns with `kernel_abi > CURRENT_KERNEL_ABI` are rejected. Patterns
 * without `kernel_abi` get a warning and default semantics.
 */
const CURRENT_KERNEL_ABI = 2;

/**
 * Pattern Registry – lädt alle system.md Dateien,
 * trennt YAML-Frontmatter (für Router) vom Prompt (für Ausführung).
 */
export class PatternRegistry {
  private patterns = new Map<string, Pattern>();
  private toolAvailability = new Map<string, boolean>();
  readonly patternsDir: string;
  readonly patternsDirs: readonly string[];

  constructor(patternsDir: string | string[]) {
    const dirs = Array.isArray(patternsDir) ? patternsDir : [patternsDir];
    this.patternsDirs = dirs;
    this.patternsDir = dirs[0] ?? "";
    // Load in reverse order: lowest priority first, highest priority overwrites
    for (const dir of [...dirs].reverse()) {
      this.loadAll(dir);
    }
  }

  /** Ein Pattern laden und parsen */
  private loadPattern(dir: string, name: string): Pattern | null {
    const filePath = join(dir, name, "system.md");
    if (!existsSync(filePath)) return null;

    const raw = readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);

    const meta: PatternMeta = {
      name: data.name ?? name,
      version: data.version,
      description: data.description ?? "",
      category: data.category ?? "uncategorized",
      input_type: data.input_type ?? "text",
      output_type: data.output_type ?? "text",
      tags: data.tags ?? [],
      parameters: data.parameters as PatternParameter[] | undefined,
      needs_context: data.needs_context,
      can_follow: data.can_follow,
      can_precede: data.can_precede,
      parallelizable_with: data.parallelizable_with,
      persona: data.persona,
      preferred_provider: data.preferred_provider,
      selection_strategy: data.selection_strategy,
      internal: data.internal ?? false,
      kernel_abi: data.kernel_abi,
      type: data.type ?? "llm",
      tool: data.tool,
      tool_args: data.tool_args,
      driver: data.driver,
      operation: data.operation,
      internal_op: data.internal_op,
      compliance_tags: data.compliance_tags,
      trust_boundary: data.trust_boundary,
      input_format: data.input_format,
      output_format: data.output_format,
      requires: data.requires,
      output_extraction: data.output_extraction
        ? {
            artifact_pattern: data.output_extraction.artifact_pattern,
            artifact_type: data.output_extraction.artifact_type,
            summary_strategy: data.output_extraction.summary_strategy,
          }
        : undefined,
    };

    if (!meta.kernel_abi) {
      console.error(`⚠️  Pattern "${meta.name}" hat kein kernel_abi Feld`);
    } else if (meta.kernel_abi > CURRENT_KERNEL_ABI) {
      console.error(`❌ Pattern "${meta.name}" benötigt kernel_abi ${meta.kernel_abi}, Kernel unterstützt ${CURRENT_KERNEL_ABI}`);
      return null;
    }

    try {
      validateOutputExtraction(meta.name, meta.output_extraction);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`❌ ${msg}`);
      return null;
    }

    return { meta, systemPrompt: content.trim(), filePath };
  }

  /** Alle Patterns aus dem Verzeichnis laden */
  private loadAll(dir: string): void {
    if (!existsSync(dir)) return;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pattern = this.loadPattern(dir, entry.name);
      if (pattern) this.patterns.set(pattern.meta.name, pattern);
    }
  }

  /** Virtuelles Pattern registrieren (z.B. MCP-Tools) */
  registerVirtual(pattern: Pattern): void {
    this.patterns.set(pattern.meta.name, pattern);
  }

  /** Pattern entfernen (z.B. bei MCP-Server-Entfernung) */
  unregister(name: string): boolean {
    return this.patterns.delete(name);
  }

  /** Pattern by name */
  get(name: string): Pattern | undefined {
    return this.patterns.get(name);
  }

  /** Alle Pattern-Namen */
  list(): string[] {
    return [...this.patterns.keys()];
  }

  /** Alle Patterns */
  all(): Pattern[] {
    return [...this.patterns.values()];
  }

  /** Patterns nach Kategorie filtern */
  byCategory(category: string): Pattern[] {
    return this.all().filter((p) => p.meta.category === category);
  }

  /** Alle Kategorien auflisten */
  categories(): string[] {
    const cats = new Set<string>();
    for (const p of this.patterns.values()) {
      if (!p.meta.internal) cats.add(p.meta.category);
    }
    return [...cats].sort();
  }

  /** Patterns durchsuchen (Name, Beschreibung, Tags) */
  search(query: string): Pattern[] {
    const q = query.toLowerCase();
    const terms = q.split(/\s+/);
    return this.all().filter((p) => {
      if (p.meta.internal) return false;
      const haystack = [
        p.meta.name,
        p.meta.description,
        p.meta.category,
        ...p.meta.tags,
      ].join(" ").toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }

  /** Prüft ob ein CLI-Tool auf dem System verfügbar ist (cached) */
  isToolAvailable(tool: string): boolean {
    if (this.toolAvailability.has(tool)) {
      return this.toolAvailability.get(tool)!;
    }
    let available = false;
    try {
      // Cross-platform: 'where' auf Windows, 'which' auf Unix
      const cmd = process.platform === "win32" ? "where" : "which";
      execFileSync(cmd, [tool], { stdio: "ignore" });
      available = true;
    } catch {
      available = false;
    }
    this.toolAvailability.set(tool, available);
    return available;
  }

  /** Alle Tool-Patterns auflisten */
  toolPatterns(): Pattern[] {
    return this.all().filter((p) => p.meta.type === "tool");
  }

  /** Kompakten Katalog-Text für den Router bauen (nur Metadaten) */
  buildCatalog(): string {
    const lines: string[] = [];
    let i = 1;

    for (const p of this.patterns.values()) {
      if (p.meta.internal) continue;

      const typeBadge = p.meta.type === "mcp" ? "MCP" : p.meta.type === "tool" ? "TOOL" : p.meta.type === "internal" ? "INTERNAL" : "LLM";
      const available = p.meta.type === "tool" && p.meta.tool
        ? (this.isToolAvailable(p.meta.tool) ? "" : " [NICHT VERFÜGBAR]")
        : "";

      lines.push(`${i}. ${p.meta.name}`);
      lines.push(`   ${p.meta.description}`);
      lines.push(`   Input: ${p.meta.input_type} → Output: ${p.meta.output_type}`);
      lines.push(`   Typ: ${typeBadge} | Kategorie: ${p.meta.category} | Tags: ${p.meta.tags.join(", ") || "-"}${available}`);
      if (p.meta.type === "mcp" && p.meta.mcp_server && p.meta.mcp_tool) {
        lines.push(`   MCP-Server: ${p.meta.mcp_server} | Tool: ${p.meta.mcp_tool}`);
        if (p.meta.mcp_input_schema) {
          const schema = p.meta.mcp_input_schema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
          if (schema.properties) {
            const params = Object.entries(schema.properties).map(([name, prop]) => {
              const req = schema.required?.includes(name) ? "*" : "";
              return `${name}${req}: ${prop.type ?? "any"}`;
            });
            lines.push(`   Parameter: ${params.join(", ")}`);
          }
        }
      }
      if (p.meta.driver) lines.push(`   Driver: ${p.meta.driver}/${p.meta.operation ?? "?"}`);
      else if (p.meta.tool) lines.push(`   CLI-Tool: ${p.meta.tool}`);
      if (p.meta.persona) lines.push(`   Persona: ${p.meta.persona}`);
      if (p.meta.parallelizable_with?.length)
        lines.push(`   Parallel mit: ${p.meta.parallelizable_with.join(", ")}`);
      if (p.meta.can_follow?.length)
        lines.push(`   Folgt auf: ${p.meta.can_follow.join(", ")}`);
      lines.push("");
      i++;
    }

    return lines.join("\n");
  }
}
