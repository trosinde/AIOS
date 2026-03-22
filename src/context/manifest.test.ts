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
  assertPathWithinBase,
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

  it("wirft bei null/undefined Manifest", () => {
    expect(() => validateManifest(null as unknown as ContextManifest)).toThrow("kein Objekt");
    expect(() => validateManifest(undefined as unknown as ContextManifest)).toThrow("kein Objekt");
  });

  it("ergänzt fehlende Array-Felder bei Validierung", () => {
    const partial = { name: "test", description: "d", type: "project" } as ContextManifest;
    validateManifest(partial);
    expect(Array.isArray(partial.capabilities)).toBe(true);
    expect(Array.isArray(partial.exports)).toBe(true);
    expect(Array.isArray(partial.links)).toBe(true);
  });

  it("ergänzt fehlende config bei Validierung", () => {
    const partial = { name: "test", description: "d", type: "project" } as ContextManifest;
    validateManifest(partial);
    expect(partial.config).toBeDefined();
    expect(partial.config.default_provider).toBe("claude");
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

  // ─── Links Roundtrip ─────────────────────────────────────

  it("persistiert Links korrekt (write → read roundtrip)", () => {
    const manifest = createDefaultManifest("linked-ctx", "team");
    manifest.description = "Kontext mit Links";
    manifest.links = [
      { name: "securitas", path: "/tmp/securitas", relationship: "consults" },
      { name: "devops", path: "/tmp/devops", relationship: "feeds" },
    ];

    writeManifest(tmpDir, manifest);
    const loaded = readManifest(tmpDir);

    expect(loaded.links).toHaveLength(2);
    expect(loaded.links[0].name).toBe("securitas");
    expect(loaded.links[0].relationship).toBe("consults");
    expect(loaded.links[1].name).toBe("devops");
    expect(loaded.links[1].relationship).toBe("feeds");
  });

  it("persistiert bidirektionale Links zwischen zwei Kontexten", () => {
    const dir1 = join(tmpDir, "securitas");
    const dir2 = join(tmpDir, "network");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    const securitas = createDefaultManifest("securitas", "team");
    securitas.description = "Security-Team";
    securitas.links = [{ name: "network", path: dir2, relationship: "consults" }];

    const network = createDefaultManifest("network", "team");
    network.description = "Network-Team";
    network.links = [{ name: "securitas", path: dir1, relationship: "consults" }];

    writeManifest(dir1, securitas);
    writeManifest(dir2, network);

    const loadedSec = readManifest(dir1);
    const loadedNet = readManifest(dir2);

    expect(loadedSec.links[0].name).toBe("network");
    expect(loadedNet.links[0].name).toBe("securitas");
    expect(loadedSec.links[0].path).toBe(dir2);
    expect(loadedNet.links[0].path).toBe(dir1);
  });

  // ─── assertPathWithinBase ───────────────────────────────

  it("akzeptiert Pfad innerhalb der Basis", () => {
    expect(() => assertPathWithinBase("/home/user/project/.aios/patterns", "/home/user/project")).not.toThrow();
  });

  it("blockiert Path Traversal", () => {
    expect(() => assertPathWithinBase("/home/user/project/.aios/../../etc", "/home/user/project"))
      .toThrow("Path Traversal");
  });

  it("blockiert absoluten Pfad außerhalb der Basis", () => {
    expect(() => assertPathWithinBase("/etc/passwd", "/home/user/project"))
      .toThrow("Path Traversal");
  });
});
