import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ContextManager, type ContextConfig } from "./context.js";
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

  it("context.yaml enthält korrektes Format", () => {
    cm.init("my-project", true, tmpDir);
    const raw = readFileSync(join(tmpDir, ".aios", "context.yaml"), "utf-8");
    expect(raw).toContain("name: my-project");
    expect(raw).toContain("version: 1");
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

  // ─── ContextConfig Format ────────────────────────────

  it("lädt alle Felder aus context.yaml", () => {
    const config: ContextConfig = {
      name: "full-test",
      version: 1,
      description: "Test context",
      domain: "testing",
      required_traits: ["compliance_references"],
      provider_defaults: { preferred: "anthropic", fallback: "ollama" },
      knowledge: { backend: "sqlite", isolation: "strict", retention_days: 90 },
      permissions: { allow_ipc: true, allow_tool_execution: true, allowed_tools: ["mmdc"] },
    };

    const contextDir = join(tmpDir, ".aios");
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, "context.yaml"), stringify(config), "utf-8");

    const active = cm.resolveActive(tmpDir);
    expect(active.name).toBe("full-test");
    expect(active.config.domain).toBe("testing");
    expect(active.config.required_traits).toEqual(["compliance_references"]);
    expect(active.config.provider_defaults?.preferred).toBe("anthropic");
    expect(active.config.knowledge?.retention_days).toBe(90);
    expect(active.config.permissions?.allowed_tools).toEqual(["mmdc"]);
  });
});
