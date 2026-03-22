import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import type { ContextManifest } from "../types.js";

// Mock getAiosHome to use temp dir
let mockHome: string;
vi.mock("../utils/config.js", () => ({
  getAiosHome: () => mockHome,
}));

const { scanContexts } = await import("./scanner.js");
const { readRegistry } = await import("./registry.js");

function createContext(dir: string, manifest: Partial<ContextManifest>): void {
  const contextDir = join(dir, ".aios");
  mkdirSync(contextDir, { recursive: true });
  const full: ContextManifest = {
    schema_version: "1.0",
    name: manifest.name ?? "test",
    description: manifest.description ?? "Test context",
    type: manifest.type ?? "project",
    capabilities: manifest.capabilities ?? [],
    exports: manifest.exports ?? [],
    accepts: manifest.accepts ?? [],
    config: manifest.config ?? {
      default_provider: "claude",
      patterns_dir: "./patterns",
      personas_dir: "./personas",
      knowledge_dir: "./knowledge",
    },
    links: manifest.links ?? [],
  };
  writeFileSync(join(contextDir, "context.yaml"), stringify(full), "utf-8");
}

describe("scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `aios-scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mockHome = join(tmpDir, "aios-home");
    mkdirSync(mockHome, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("entdeckt Kontexte in Unterverzeichnissen", () => {
    const teamA = join(tmpDir, "projects", "team-a");
    const teamB = join(tmpDir, "projects", "team-b");
    mkdirSync(teamA, { recursive: true });
    mkdirSync(teamB, { recursive: true });

    createContext(teamA, { name: "team-a", description: "Team A" });
    createContext(teamB, { name: "team-b", description: "Team B" });

    const result = scanContexts([join(tmpDir, "projects")]);

    expect(result.discovered).toHaveLength(2);
    expect(result.discovered.map((p) => p)).toContain(teamA);
    expect(result.discovered.map((p) => p)).toContain(teamB);

    const registry = readRegistry();
    expect(registry.contexts).toHaveLength(2);
  });

  it("aktualisiert bereits registrierte Kontexte", () => {
    const teamDir = join(tmpDir, "team");
    mkdirSync(teamDir, { recursive: true });
    createContext(teamDir, { name: "team", description: "Erstversion" });

    // First scan: discover
    const result1 = scanContexts([tmpDir]);
    expect(result1.discovered).toHaveLength(1);

    // Modify manifest
    createContext(teamDir, { name: "team", description: "Aktualisiert", type: "team" });

    // Second scan: update
    const result2 = scanContexts([tmpDir]);
    expect(result2.updated).toHaveLength(1);
    expect(result2.discovered).toHaveLength(0);

    const registry = readRegistry();
    expect(registry.contexts).toHaveLength(1);
    expect(registry.contexts[0].description).toBe("Aktualisiert");
    expect(registry.contexts[0].type).toBe("team");
  });

  it("entfernt verwaiste Einträge aus der Registry", () => {
    const teamDir = join(tmpDir, "ephemeral");
    mkdirSync(teamDir, { recursive: true });
    createContext(teamDir, { name: "ephemeral" });

    // First scan: discover
    scanContexts([tmpDir]);
    expect(readRegistry().contexts).toHaveLength(1);

    // Delete the context
    rmSync(join(teamDir, ".aios"), { recursive: true, force: true });

    // Second scan: stale detection
    const result = scanContexts([tmpDir]);
    expect(result.stale).toHaveLength(1);
    expect(readRegistry().contexts).toHaveLength(0);
  });

  it("erkennt defekte Links", () => {
    const securitas = join(tmpDir, "securitas");
    const nonExistent = join(tmpDir, "does-not-exist");
    mkdirSync(securitas, { recursive: true });

    createContext(securitas, {
      name: "securitas",
      links: [{ name: "phantom", path: nonExistent, relationship: "consults" }],
    });

    const result = scanContexts([tmpDir]);

    expect(result.brokenLinks).toHaveLength(1);
    expect(result.brokenLinks[0].context).toBe("securitas");
    expect(result.brokenLinks[0].linkName).toBe("phantom");
  });

  it("validiert intakte bidirektionale Links", () => {
    const teamA = join(tmpDir, "team-a");
    const teamB = join(tmpDir, "team-b");
    mkdirSync(teamA, { recursive: true });
    mkdirSync(teamB, { recursive: true });

    createContext(teamA, {
      name: "team-a",
      type: "team",
      links: [{ name: "team-b", path: teamB, relationship: "consults" }],
    });
    createContext(teamB, {
      name: "team-b",
      type: "team",
      links: [{ name: "team-a", path: teamA, relationship: "consults" }],
    });

    const result = scanContexts([tmpDir]);

    expect(result.discovered).toHaveLength(2);
    expect(result.brokenLinks).toHaveLength(0);

    const registry = readRegistry();
    expect(registry.contexts).toHaveLength(2);
    const a = registry.contexts.find((c) => c.name === "team-a");
    const b = registry.contexts.find((c) => c.name === "team-b");
    expect(a?.links).toHaveLength(1);
    expect(b?.links).toHaveLength(1);
  });

  it("respektiert maxDepth", () => {
    const deep = join(tmpDir, "a", "b", "c", "d", "e");
    mkdirSync(deep, { recursive: true });
    createContext(deep, { name: "deep" });

    const shallow = scanContexts([tmpDir], 2);
    expect(shallow.discovered).toHaveLength(0);

    const deepScan = scanContexts([tmpDir], 6);
    expect(deepScan.discovered).toHaveLength(1);
  });

  it("überspringt node_modules und versteckte Verzeichnisse", () => {
    const hidden = join(tmpDir, ".hidden-project");
    const nodemod = join(tmpDir, "node_modules", "pkg");
    mkdirSync(hidden, { recursive: true });
    mkdirSync(nodemod, { recursive: true });

    createContext(hidden, { name: "hidden" });
    createContext(nodemod, { name: "in-node-modules" });

    const result = scanContexts([tmpDir]);
    expect(result.discovered).toHaveLength(0);
  });

  it("gibt leeres Ergebnis bei leerem Verzeichnis", () => {
    const result = scanContexts([tmpDir]);
    expect(result.discovered).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.brokenLinks).toEqual([]);
  });

  it("gibt leeres Ergebnis bei nicht-existentem Pfad", () => {
    const result = scanContexts([join(tmpDir, "nope")]);
    expect(result.discovered).toEqual([]);
  });
});
