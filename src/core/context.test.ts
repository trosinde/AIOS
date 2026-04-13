import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ContextManager, type ContextConfig } from "./context.js";
import { parseContextYaml } from "../init/schema.js";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify } from "yaml";

describe("ContextManager", () => {
  let cm: ContextManager;
  let tmpDir: string;

  beforeEach(() => {
    cm = new ContextManager();
    tmpDir = join(tmpdir(), `aios-ctx-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── init ────────────────────────────────────────────

  it("erstellt einen lokalen Context", () => {
    const path = cm.init("test-project", true, tmpDir);
    expect(path).toBe(join(tmpDir, ".aios"));
    expect(existsSync(join(path, "context.yaml"))).toBe(true);
    expect(existsSync(join(path, "patterns"))).toBe(true);
    expect(existsSync(join(path, "personas"))).toBe(true);
    expect(existsSync(join(path, "knowledge"))).toBe(true);
  });

  it("context.yaml enthält unified format", () => {
    cm.init("my-project", true, tmpDir);
    const raw = readFileSync(join(tmpDir, ".aios", "context.yaml"), "utf-8");
    expect(raw).toContain("name: my-project");
    expect(raw).toContain("schema_version");
    expect(raw).toContain("type: project");
  });

  it("wirft Fehler wenn Context schon existiert", () => {
    cm.init("dup-test", true, tmpDir);
    expect(() => cm.init("dup-test", true, tmpDir)).toThrow("existiert bereits");
  });

  // ─── resolveActive ──────────────────────────────────

  it("löst projekt-lokalen Context auf", () => {
    cm.init("local-ctx", true, tmpDir);
    const active = cm.resolveActive(tmpDir);
    expect(active.name).toBe("local-ctx");
    expect(active.source).toBe("project");
    expect(active.path).toBe(join(tmpDir, ".aios"));
  });

  it("gibt default zurück wenn kein Context vorhanden", () => {
    const active = cm.resolveActive(tmpDir);
    expect(active.name).toBe("default");
    expect(active.source).toBe("global");
  });

  // ─── list ────────────────────────────────────────────

  it("listet projekt-lokale Contexts", () => {
    cm.init("listed-ctx", true, tmpDir);
    const list = cm.list(tmpDir);
    expect(list.some(c => c.name === "listed-ctx")).toBe(true);
    expect(list.find(c => c.name === "listed-ctx")!.source).toBe("project");
  });

  // ─── patternDirs ─────────────────────────────────────

  it("baut Pattern-Lookup-Reihenfolge auf", () => {
    cm.init("patterns-test", true, tmpDir);
    const active = cm.resolveActive(tmpDir);
    const repoPatterns = join(tmpDir, "patterns");
    mkdirSync(repoPatterns, { recursive: true });

    const dirs = cm.patternDirs(active, repoPatterns);
    // Projekt-lokal vor Repository
    expect(dirs[0]).toBe(join(tmpDir, ".aios", "patterns"));
    expect(dirs[1]).toBe(repoPatterns);
  });

  it("überspringt nicht-existierende Verzeichnisse", () => {
    const active = cm.resolveActive(tmpDir);  // default context
    const dirs = cm.patternDirs(active, "/tmp/nonexistent-patterns-xyz");
    // Sollte keine nicht-existierenden Verzeichnisse enthalten
    for (const d of dirs) {
      expect(existsSync(d)).toBe(true);
    }
  });

  // ─── ensureKernelDirs ────────────────────────────────

  it("erstellt Kernel-Verzeichnisse", () => {
    cm.ensureKernelDirs();
    // Just verify it doesn't throw
    // Actual dirs are in ~/.aios/kernel/ which we don't want to test destructively
  });

  // ─── Unified ContextConfig Format ─────────────────────

  it("lädt alle Felder aus unified context.yaml", () => {
    const config: ContextConfig = {
      schema_version: "1.0",
      name: "full-test",
      description: "Test context",
      type: "project",
      capabilities: [],
      exports: [],
      accepts: [],
      links: [],
      config: {
        default_provider: "claude",
        patterns_dir: "./patterns",
        personas_dir: "./personas",
        knowledge_dir: "./knowledge",
      },
      project: { domain: "testing", language: "typescript" },
      required_traits: ["compliance_references"],
      providers: { routing: { complex: "anthropic" } },
      knowledge: { backend: "sqlite", isolation: "strict", retention_days: 90 },
      permissions: { allow_ipc: true, allow_tool_execution: true, allowed_tools: ["mmdc"] },
    };

    const contextDir = join(tmpDir, ".aios");
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, "context.yaml"), stringify(config), "utf-8");

    const active = cm.resolveActive(tmpDir);
    expect(active.name).toBe("full-test");
    expect(active.config.project?.domain).toBe("testing");
    expect(active.config.required_traits).toEqual(["compliance_references"]);
    expect(active.config.providers?.routing?.complex).toBe("anthropic");
    expect(active.config.knowledge?.retention_days).toBe(90);
    expect(active.config.permissions?.allowed_tools).toEqual(["mmdc"]);
    expect(active.config.type).toBe("project");
    expect(active.config.schema_version).toBe("1.0");
  });

  it("normalisiert altes lightweight format beim Laden", () => {
    // Simulate a minimal old-format context.yaml (just name + version)
    const contextDir = join(tmpDir, ".aios");
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, "context.yaml"), stringify({
      name: "old-format",
      version: 1,
      description: "Legacy context",
    }), "utf-8");

    const active = cm.resolveActive(tmpDir);
    expect(active.name).toBe("old-format");
    expect(active.config.schema_version).toBe("1.0"); // Normalized
    expect(active.config.type).toBe("project"); // Default
    expect(active.config.capabilities).toEqual([]); // Default
  });

  it("fällt auf default zurück bei korrupter context.yaml", () => {
    const contextDir = join(tmpDir, ".aios");
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, "context.yaml"), "{{invalid yaml: [[[", "utf-8");

    const active = cm.resolveActive(tmpDir);
    expect(active.name).toBe("default"); // Falls back to default
    expect(active.source).toBe("global");
  });

  it("fällt auf default zurück bei context.yaml ohne name", () => {
    const contextDir = join(tmpDir, ".aios");
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, "context.yaml"), "description: no-name\n", "utf-8");

    const active = cm.resolveActive(tmpDir);
    expect(active.name).toBe("default");
  });

  // ─── rename ────────────────────────────────────────────

  it("benennt einen lokalen Context um", () => {
    cm.init("old-name", true, tmpDir);
    const result = cm.rename("old-name", "new-name", tmpDir);
    expect(result.source).toBe("project");

    const active = cm.resolveActive(tmpDir);
    expect(active.name).toBe("new-name");
  });

  it("wirft Fehler bei ungültigem neuen Namen", () => {
    cm.init("valid-ctx", true, tmpDir);
    expect(() => cm.rename("valid-ctx", "INVALID NAME!", tmpDir)).toThrow("Ungültiger Name");
    expect(() => cm.rename("valid-ctx", "has_underscore", tmpDir)).toThrow("Ungültiger Name");
  });

  it("wirft Fehler bei ungültigem alten Namen (Path-Traversal-Schutz)", () => {
    expect(() => cm.rename("../escape", "new-name", tmpDir)).toThrow("Ungültiger Name");
    expect(() => cm.rename("../../etc", "new-name", tmpDir)).toThrow("Ungültiger Name");
  });

  it("wirft Fehler wenn alter und neuer Name identisch", () => {
    cm.init("same-name", true, tmpDir);
    expect(() => cm.rename("same-name", "same-name", tmpDir)).toThrow("identisch");
  });

  it("wirft Fehler wenn Context nicht gefunden", () => {
    expect(() => cm.rename("nonexistent", "new-name", tmpDir)).toThrow("nicht gefunden");
  });

  it("aktualisiert context.yaml korrekt nach Rename", () => {
    cm.init("before-rename", true, tmpDir);
    cm.rename("before-rename", "after-rename", tmpDir);
    const raw = readFileSync(join(tmpDir, ".aios", "context.yaml"), "utf-8");
    expect(raw).toContain("name: after-rename");
    expect(raw).not.toContain("name: before-rename");
    // Other fields preserved
    expect(raw).toContain("schema_version");
    expect(raw).toContain("type: project");
  });

  // ─── Cross-module round-trip ──────────────────────────

  it("ContextManager.init() schreibt parseContextYaml-kompatibles Format", () => {
    cm.init("roundtrip-test", true, tmpDir, { type: "team", description: "Round-trip" });
    const raw = readFileSync(join(tmpDir, ".aios", "context.yaml"), "utf-8");

    // Must be parseable by the unified parser
    const parsed = parseContextYaml(raw);
    expect(parsed.name).toBe("roundtrip-test");
    expect(parsed.type).toBe("team");
    expect(parsed.description).toBe("Round-trip");
    expect(parsed.schema_version).toBe("1.0");
  });

  // ─── switch error path ────────────────────────────────

  it("switch wirft Fehler wenn Context nicht existiert", () => {
    expect(() => cm.switch("nonexistent-ctx-xyz")).toThrow("existiert nicht");
  });

  // ─── patternDirs with global context ──────────────────

  it("patternDirs inkludiert context-spezifische Patterns für globalen Context", () => {
    // Simulate a global context with name != "default"
    const contextDir = join(tmpDir, "global-ctx");
    mkdirSync(join(contextDir, "patterns"), { recursive: true });

    const globalActive = {
      name: "my-global",
      path: contextDir,
      source: "global" as const,
      config: {
        schema_version: "1.0",
        name: "my-global",
        description: "Test",
        type: "project" as const,
        capabilities: [],
        exports: [],
        accepts: [],
        links: [],
        config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      },
    };

    const dirs = cm.patternDirs(globalActive, "/tmp/nonexistent-repo");
    // Should include context patterns since it's a non-default global context
    expect(dirs[0]).toBe(join(contextDir, "patterns"));
  });

  it("patternDirs excludiert context-Patterns für default Context", () => {
    const defaultActive = {
      name: "default",
      path: tmpDir,
      source: "global" as const,
      config: {
        schema_version: "1.0",
        name: "default",
        description: "Default",
        type: "project" as const,
        capabilities: [],
        exports: [],
        accepts: [],
        links: [],
        config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      },
    };

    const dirs = cm.patternDirs(defaultActive, "/tmp/nonexistent-repo");
    // Default global context should NOT add context-specific patterns
    expect(dirs.every(d => !d.includes(tmpDir))).toBe(true);
  });

  // ─── init with options ────────────────────────────────

  it("init nutzt type und description aus opts", () => {
    const path = cm.init("opts-test", true, tmpDir, { type: "team", description: "My Team" });
    const raw = readFileSync(join(path, "context.yaml"), "utf-8");
    expect(raw).toContain("type: team");
    expect(raw).toContain("description: My Team");
  });

  // ─── list returns empty when no contexts exist ────────

  it("list gibt leere Liste zurück wenn keine Contexts existieren", () => {
    const list = cm.list(tmpDir);
    // tmpDir has no .aios/ yet
    expect(list).toEqual([]);
  });
});
