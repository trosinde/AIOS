import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import type { Pattern, PatternMeta, PatternParameter } from "../types.js";

/**
 * Pattern Registry – lädt alle system.md Dateien,
 * trennt YAML-Frontmatter (für Router) vom Prompt (für Ausführung).
 */
export class PatternRegistry {
  private patterns = new Map<string, Pattern>();
  readonly patternsDir: string;

  constructor(patternsDir: string) {
    this.patternsDir = patternsDir;
    this.loadAll(patternsDir);
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
      internal: data.internal ?? false,
    };

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

  /** Kompakten Katalog-Text für den Router bauen (nur Metadaten) */
  buildCatalog(): string {
    const lines: string[] = [];
    let i = 1;

    for (const p of this.patterns.values()) {
      if (p.meta.internal) continue;

      lines.push(`${i}. ${p.meta.name}`);
      lines.push(`   ${p.meta.description}`);
      lines.push(`   Input: ${p.meta.input_type} → Output: ${p.meta.output_type}`);
      lines.push(`   Kategorie: ${p.meta.category} | Tags: ${p.meta.tags.join(", ") || "-"}`);
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
