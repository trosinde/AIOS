import { describe, it, expect, beforeAll } from "vitest";
import { join } from "path";
import { PatternRegistry } from "./registry.js";

const PATTERNS_DIR = join(process.cwd(), "patterns");

describe("PatternRegistry", () => {
  let registry: PatternRegistry;

  beforeAll(() => {
    registry = new PatternRegistry(PATTERNS_DIR);
  });

  it("lädt Patterns aus dem Verzeichnis", () => {
    const names = registry.list();
    expect(names.length).toBeGreaterThan(0);
  });

  it("enthält bekannte Patterns", () => {
    expect(registry.get("summarize")).toBeDefined();
    expect(registry.get("code_review")).toBeDefined();
    expect(registry.get("security_review")).toBeDefined();
  });

  it("gibt undefined für unbekannte Patterns", () => {
    expect(registry.get("nonexistent_pattern")).toBeUndefined();
  });

  it("parst Frontmatter korrekt", () => {
    const p = registry.get("summarize")!;
    expect(p.meta.name).toBe("summarize");
    expect(p.meta.description).toBeTruthy();
    expect(p.meta.category).toBeTruthy();
    expect(p.meta.input_type).toBeTruthy();
    expect(p.meta.output_type).toBeTruthy();
    expect(Array.isArray(p.meta.tags)).toBe(true);
  });

  it("hat systemPrompt ohne Frontmatter", () => {
    const p = registry.get("summarize")!;
    expect(p.systemPrompt).toBeTruthy();
    expect(p.systemPrompt).not.toContain("---");
  });

  it("hat filePath gesetzt", () => {
    const p = registry.get("summarize")!;
    expect(p.filePath).toContain("summarize");
    expect(p.filePath).toContain("system.md");
  });

  it("all() gibt alle Patterns zurück", () => {
    const all = registry.all();
    expect(all.length).toBe(registry.list().length);
  });

  it("blendet interne Patterns im Katalog aus", () => {
    const catalog = registry.buildCatalog();
    expect(catalog).not.toContain("_router");
  });

  it("Katalog enthält Pattern-Infos", () => {
    const catalog = registry.buildCatalog();
    expect(catalog).toContain("summarize");
    expect(catalog).toContain("code_review");
  });

  it("behandelt nicht-existierendes Verzeichnis graceful", () => {
    const empty = new PatternRegistry("/tmp/nonexistent_dir_12345");
    expect(empty.list()).toEqual([]);
  });

  it("parallelizable_with wird korrekt geladen", () => {
    const p = registry.get("code_review");
    if (p?.meta.parallelizable_with) {
      expect(Array.isArray(p.meta.parallelizable_with)).toBe(true);
    }
  });

  // ─── Phase 2: Neue Features ──────────────────────────────

  it("search() findet Patterns nach Name", () => {
    const results = registry.search("summarize");
    expect(results.some((p) => p.meta.name === "summarize")).toBe(true);
  });

  it("search() findet Patterns nach Tag", () => {
    const results = registry.search("security");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((p) => p.meta.tags.includes("security"))).toBe(true);
  });

  it("search() findet nichts bei Unsinn", () => {
    const results = registry.search("xyznonexistent123");
    expect(results).toEqual([]);
  });

  it("search() blendet interne Patterns aus", () => {
    const results = registry.search("router");
    expect(results.every((p) => !p.meta.internal)).toBe(true);
  });

  it("byCategory() filtert korrekt", () => {
    const reviews = registry.byCategory("review");
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every((p) => p.meta.category === "review")).toBe(true);
  });

  it("byCategory() gibt leer bei unbekannter Kategorie", () => {
    const results = registry.byCategory("nonexistent_category");
    expect(results).toEqual([]);
  });

  it("categories() listet alle Kategorien", () => {
    const cats = registry.categories();
    expect(cats).toContain("review");
    expect(cats).toContain("analyze");
    expect(cats).toContain("generate");
    expect(cats).toContain("transform");
    expect(cats).toContain("report");
  });

  it("enthält neue Phase-2 Patterns", () => {
    expect(registry.get("gap_analysis")).toBeDefined();
    expect(registry.get("identify_risks")).toBeDefined();
    expect(registry.get("generate_docs")).toBeDefined();
    expect(registry.get("refactor")).toBeDefined();
    expect(registry.get("test_report")).toBeDefined();
  });

  it("hat 24+ Patterns geladen (13 alt + 13 neu)", () => {
    expect(registry.list().length).toBeGreaterThanOrEqual(24);
  });

  it("parst parameters korrekt", () => {
    const p = registry.get("gap_analysis")!;
    expect(p.meta.parameters).toBeDefined();
    expect(p.meta.parameters!.length).toBeGreaterThan(0);
    expect(p.meta.parameters![0].name).toBe("reference");
    expect(p.meta.parameters![0].type).toBe("enum");
    expect(p.meta.parameters![0].values).toContain("iec62443");
  });

  it("parst version korrekt", () => {
    const p = registry.get("gap_analysis")!;
    expect(p.meta.version).toBe("1.0");
  });

  it("patternsDir ist gesetzt", () => {
    expect(registry.patternsDir).toBe(PATTERNS_DIR);
  });
});
