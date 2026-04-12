import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
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

  // ─── Tool-Pattern Tests ────────────────────────────────

  it("parst type: tool mit driver/operation korrekt", () => {
    const p = registry.get("render_diagram")!;
    expect(p.meta.type).toBe("tool");
    expect(p.meta.driver).toBe("mermaid");
    expect(p.meta.operation).toBe("render");
  });

  it("parst type: llm als Default", () => {
    const p = registry.get("summarize")!;
    expect(p.meta.type).toBe("llm");
    expect(p.meta.tool).toBeUndefined();
  });

  it("generate_diagram ist LLM-Pattern", () => {
    const p = registry.get("generate_diagram")!;
    expect(p.meta.type).toBe("llm");
    expect(p.meta.output_type).toBe("mermaid_code");
  });

  it("render_diagram hat output_format", () => {
    const p = registry.get("render_diagram")!;
    expect(p.meta.output_format).toContain("svg");
    expect(p.meta.output_format).toContain("png");
    expect(p.meta.input_format).toBe("mmd");
  });

  it("toolPatterns() gibt nur Tool-Patterns zurück", () => {
    const tools = registry.toolPatterns();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((p) => p.meta.type === "tool")).toBe(true);
    expect(tools.some((p) => p.meta.name === "render_diagram")).toBe(true);
  });

  it("isToolAvailable() erkennt installierte Tools", () => {
    // 'node' ist garantiert verfügbar wenn wir Tests ausführen
    expect(registry.isToolAvailable("node")).toBe(true);
    expect(registry.isToolAvailable("nonexistent_tool_xyz_123")).toBe(false);
  });

  it("buildCatalog() enthält Typ-Badge", () => {
    const catalog = registry.buildCatalog();
    expect(catalog).toContain("Typ: TOOL");
    expect(catalog).toContain("Typ: LLM");
    expect(catalog).toContain("Driver: mermaid/render");
  });

  it("categories() enthält tool-Kategorie", () => {
    const cats = registry.categories();
    expect(cats).toContain("tool");
  });

  it("hat 28 Patterns geladen (26 alt + 2 diagram)", () => {
    expect(registry.list().length).toBeGreaterThanOrEqual(28);
  });

  // ─── Multi-Directory Pattern Resolution ─────────────────

  describe("Multi-Directory Support", () => {
    const tmpBase = join(process.cwd(), "tmp-test-patterns");
    const dirA = join(tmpBase, "dir-a");
    const dirB = join(tmpBase, "dir-b");

    function writePattern(dir: string, name: string, description: string): void {
      const patternDir = join(dir, name);
      mkdirSync(patternDir, { recursive: true });
      writeFileSync(join(patternDir, "system.md"), [
        "---",
        "kernel_abi: 1",
        `name: ${name}`,
        `description: "${description}"`,
        "category: test",
        "input_type: text",
        "output_type: text",
        "tags: []",
        "---",
        "",
        `Prompt for ${name} from ${description}`,
      ].join("\n"));
    }

    beforeEach(() => {
      mkdirSync(dirA, { recursive: true });
      mkdirSync(dirB, { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpBase, { recursive: true, force: true });
    });

    it("lädt Patterns aus mehreren Verzeichnissen", () => {
      writePattern(dirA, "pattern_a", "dir-a");
      writePattern(dirB, "pattern_b", "dir-b");

      const reg = new PatternRegistry([dirA, dirB]);
      expect(reg.get("pattern_a")).toBeDefined();
      expect(reg.get("pattern_b")).toBeDefined();
    });

    it("höhere Priorität überschreibt niedrigere (erstes Dir gewinnt)", () => {
      writePattern(dirA, "shared_pattern", "high-priority");
      writePattern(dirB, "shared_pattern", "low-priority");

      const reg = new PatternRegistry([dirA, dirB]);
      const p = reg.get("shared_pattern")!;
      expect(p.meta.description).toBe("high-priority");
      expect(p.systemPrompt).toContain("high-priority");
    });

    it("patternsDir gibt erstes Verzeichnis zurück (Backward-Compat)", () => {
      const reg = new PatternRegistry([dirA, dirB]);
      expect(reg.patternsDir).toBe(dirA);
    });

    it("patternsDirs gibt alle Verzeichnisse zurück", () => {
      const reg = new PatternRegistry([dirA, dirB]);
      expect(reg.patternsDirs).toEqual([dirA, dirB]);
    });

    it("leeres Array erzeugt leere Registry", () => {
      const reg = new PatternRegistry([]);
      expect(reg.list()).toEqual([]);
      expect(reg.patternsDir).toBe("");
    });

    it("einzelner String funktioniert weiterhin", () => {
      writePattern(dirA, "solo_pattern", "solo");
      const reg = new PatternRegistry(dirA);
      expect(reg.get("solo_pattern")).toBeDefined();
      expect(reg.patternsDir).toBe(dirA);
      expect(reg.patternsDirs).toEqual([dirA]);
    });

    it("ignoriert nicht-existierende Verzeichnisse im Array", () => {
      writePattern(dirA, "pattern_a", "dir-a");
      const reg = new PatternRegistry([dirA, "/tmp/nonexistent_xyz_98765"]);
      expect(reg.get("pattern_a")).toBeDefined();
      expect(reg.list().length).toBe(1);
    });

    it("behandelt doppelte Verzeichnisse ohne Fehler", () => {
      writePattern(dirA, "pattern_a", "dir-a");
      const reg = new PatternRegistry([dirA, dirA]);
      expect(reg.get("pattern_a")).toBeDefined();
      expect(reg.list().length).toBe(1);
    });
  });
});
