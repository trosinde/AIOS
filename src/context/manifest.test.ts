import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import {
  hasContext,
  hasLegacyConfig,
  readManifest,
  writeManifest,
  validateManifest,
  createDefaultManifest,
  mergeWithDefaults,
} from "./manifest.js";
import type { ContextManifest } from "../types.js";

describe("manifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `aios-manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── createDefaultManifest ────────────────────────────

  it("erstellt ein valides Default-Manifest", () => {
    const m = createDefaultManifest("test", "project");
    expect(m.schema_version).toBe("1.0");
    expect(m.name).toBe("test");
    expect(m.type).toBe("project");
    expect(m.capabilities).toEqual([]);
    expect(m.exports).toEqual([]);
    expect(m.accepts).toEqual([]);
    expect(m.links).toEqual([]);
    expect(m.config.default_provider).toBe("claude");
  });

  it("erstellt Manifeste für verschiedene Typen", () => {
    const team = createDefaultManifest("team-test", "team");
    expect(team.type).toBe("team");

    const lib = createDefaultManifest("lib-test", "library");
    expect(lib.type).toBe("library");
  });

  // ─── hasContext / hasLegacyConfig ──────────────────────

  it("erkennt vorhandenen Context", () => {
    expect(hasContext(tmpDir)).toBe(false);

    const manifest = createDefaultManifest("test", "project");
    manifest.description = "Test context";
    writeManifest(tmpDir, manifest);

    expect(hasContext(tmpDir)).toBe(true);
  });

  it("erkennt Legacy-Config", () => {
    expect(hasLegacyConfig(tmpDir)).toBe(false);

    writeFileSync(join(tmpDir, "aios.yaml"), "defaults:\n  provider: claude\n", "utf-8");
    expect(hasLegacyConfig(tmpDir)).toBe(true);

    // If both exist, it's not legacy
    const manifest = createDefaultManifest("test", "project");
    manifest.description = "Test";
    writeManifest(tmpDir, manifest);
    expect(hasLegacyConfig(tmpDir)).toBe(false);
  });

  // ─── readManifest / writeManifest ──────────────────────

  it("schreibt und liest ein Manifest", () => {
    const manifest = createDefaultManifest("rw-test", "team");
    manifest.description = "Read-write test";
    manifest.capabilities = [{
      id: "testing",
      description: "Test capability",
      input_types: ["text"],
      output_type: "report",
    }];

    writeManifest(tmpDir, manifest);
    const loaded = readManifest(tmpDir);

    expect(loaded.name).toBe("rw-test");
    expect(loaded.type).toBe("team");
    expect(loaded.description).toBe("Read-write test");
    expect(loaded.capabilities).toHaveLength(1);
    expect(loaded.capabilities[0].id).toBe("testing");
  });

  it("wirft Fehler wenn kein Manifest vorhanden", () => {
    expect(() => readManifest(tmpDir)).toThrow("Kein AIOS-Kontext");
  });

  // ─── validateManifest ──────────────────────────────────

  it("validiert fehlende Pflichtfelder", () => {
    expect(() => validateManifest({} as ContextManifest)).toThrow("name");
    expect(() => validateManifest({ name: "test" } as ContextManifest)).toThrow("description");
    expect(() => validateManifest({ name: "test", description: "d", type: "invalid" as "project" } as ContextManifest))
      .toThrow("type");
  });

  it("akzeptiert valides Manifest", () => {
    const m = createDefaultManifest("valid", "project");
    m.description = "Valid";
    expect(() => validateManifest(m)).not.toThrow();
  });

  // ─── mergeWithDefaults ─────────────────────────────────

  it("merged bestehende Werte ohne sie zu überschreiben", () => {
    const existing: Partial<ContextManifest> = {
      name: "my-project",
      description: "Mein Projekt",
      type: "team",
    };
    const defaults = createDefaultManifest("default", "project");
    defaults.description = "Default desc";
    const merged = mergeWithDefaults(existing, defaults);

    expect(merged.name).toBe("my-project");
    expect(merged.type).toBe("team");
    expect(merged.description).toBe("Mein Projekt");
    expect(merged.config.default_provider).toBe("claude");
  });

  it("ergänzt fehlende Felder mit Defaults", () => {
    const existing: Partial<ContextManifest> = {
      name: "partial",
      description: "Partial manifest",
      type: "project",
    };
    const defaults = createDefaultManifest("default", "project");
    const merged = mergeWithDefaults(existing, defaults);

    expect(merged.capabilities).toEqual([]);
    expect(merged.exports).toEqual([]);
    expect(merged.links).toEqual([]);
    expect(merged.schema_version).toBe("1.0");
  });

  it("behält bestehende Config-Werte", () => {
    const existing: Partial<ContextManifest> = {
      name: "custom",
      description: "Custom config",
      type: "project",
      config: {
        default_provider: "ollama",
        patterns_dir: "./my-patterns",
        personas_dir: "./my-personas",
        knowledge_dir: "./my-knowledge",
        standards: ["IEC 62443"],
      },
    };
    const defaults = createDefaultManifest("default", "project");
    const merged = mergeWithDefaults(existing, defaults);

    expect(merged.config.default_provider).toBe("ollama");
    expect(merged.config.patterns_dir).toBe("./my-patterns");
    expect(merged.config.standards).toEqual(["IEC 62443"]);
  });
});
