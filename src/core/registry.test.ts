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
});
