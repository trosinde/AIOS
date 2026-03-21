import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify, parse } from "yaml";
import type { ContextManifest } from "../types.js";

// Mock getAiosHome to use temp dir for registry
let mockHome: string;
vi.mock("../utils/config.js", () => ({
  getAiosHome: () => mockHome,
}));

const { initContext } = await import("./init.js");
const { readManifest } = await import("./manifest.js");
const { readRegistry } = await import("./registry.js");

describe("initContext", () => {
  let tmpDir: string;

  beforeEach(() => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    tmpDir = join(tmpdir(), `aios-init-test-${id}`);
    mockHome = join(tmpdir(), `aios-home-test-${id}`);
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(mockHome, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(mockHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── Neuer Kontext ─────────────────────────────────────

  it("erstellt .aios/ Verzeichnisstruktur", async () => {
    await initContext(tmpDir, { name: "test-project", type: "project", description: "Test" });

    expect(existsSync(join(tmpDir, ".aios/context.yaml"))).toBe(true);
    expect(existsSync(join(tmpDir, ".aios/knowledge"))).toBe(true);
    expect(existsSync(join(tmpDir, ".aios/patterns"))).toBe(true);
    expect(existsSync(join(tmpDir, ".aios/personas"))).toBe(true);
    expect(existsSync(join(tmpDir, ".aios/links"))).toBe(true);
  });

  it("erstellt valides Manifest mit korrektem Schema", async () => {
    await initContext(tmpDir, { name: "schema-test", type: "team", description: "Schema test" });

    const manifest = readManifest(tmpDir);
    expect(manifest.schema_version).toBe("1.0");
    expect(manifest.name).toBe("schema-test");
    expect(manifest.type).toBe("team");
  });

  it("wendet project-Template an", async () => {
    await initContext(tmpDir, { name: "proj", template: "project", description: "Project" });
    const manifest = readManifest(tmpDir);
    expect(manifest.capabilities.some((c) => c.id === "code_generation")).toBe(true);
  });

  it("wendet team-Template an", async () => {
    await initContext(tmpDir, { name: "team", template: "team", description: "Team" });
    const manifest = readManifest(tmpDir);
    expect(manifest.config.team).toBeDefined();
    expect(manifest.config.team!.personas).toEqual([]);
  });

  it("wendet library-Template an", async () => {
    await initContext(tmpDir, { name: "lib", template: "library", description: "Lib" });
    const manifest = readManifest(tmpDir);
    expect(manifest.exports.some((e) => e.type === "patterns")).toBe(true);
  });

  it("setzt custom description", async () => {
    await initContext(tmpDir, { name: "desc-test", description: "Custom Beschreibung" });
    const manifest = readManifest(tmpDir);
    expect(manifest.description).toBe("Custom Beschreibung");
  });

  // ─── Upgrade ───────────────────────────────────────────

  it("überschreibt bestehende context.yaml nicht", async () => {
    await initContext(tmpDir, { name: "original", description: "Original" });
    await initContext(tmpDir, { name: "should-not-overwrite", description: "New" });

    const manifest = readManifest(tmpDir);
    expect(manifest.name).toBe("original");
  });

  it("erstellt fehlende Unterverzeichnisse beim Upgrade", async () => {
    // Create minimal context without links dir
    const contextDir = join(tmpDir, ".aios");
    mkdirSync(contextDir, { recursive: true });
    const manifest: ContextManifest = {
      schema_version: "1.0",
      name: "upgrade-test",
      description: "Upgrade test",
      type: "project",
      capabilities: [],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [],
    };
    writeFileSync(join(contextDir, "context.yaml"), stringify(manifest), "utf-8");

    await initContext(tmpDir, {});

    expect(existsSync(join(tmpDir, ".aios/links"))).toBe(true);
    expect(existsSync(join(tmpDir, ".aios/knowledge"))).toBe(true);
  });

  // ─── Legacy-Migration ─────────────────────────────────

  it("migriert von aios.yaml", async () => {
    writeFileSync(join(tmpDir, "aios.yaml"), stringify({
      defaults: { provider: "ollama-fast" },
      paths: { patterns: "./my-patterns" },
    }), "utf-8");

    await initContext(tmpDir, {});

    const manifest = readManifest(tmpDir);
    expect(manifest.config.default_provider).toBe("ollama-fast");
    expect(manifest.config.patterns_dir).toBe("./my-patterns");
    expect(existsSync(join(tmpDir, "aios.yaml"))).toBe(true); // Not deleted
  });

  // ─── Registry-Integration ─────────────────────────────

  it("registriert Kontext in globaler Registry", async () => {
    await initContext(tmpDir, { name: "registered-test", description: "Registered" });
    const registry = readRegistry();
    expect(registry.contexts.some((c) => c.name === "registered-test")).toBe(true);
  });

  it("nutzt Verzeichnisnamen als Default-Name", async () => {
    await initContext(tmpDir, { description: "No name" });
    const manifest = readManifest(tmpDir);
    // Name should be the last directory component
    expect(manifest.name).toBeTruthy();
  });
});
