import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import type { ContextManifest } from "../types.js";

// Mock getAiosHome to use temp dir
let mockHome: string;
vi.mock("../utils/config.js", () => ({
  getAiosHome: () => mockHome,
}));

// Import after mock
const { readRegistry, writeRegistry, registerContext, unregisterContext, buildContextCatalog } =
  await import("./registry.js");

describe("registry", () => {
  beforeEach(() => {
    mockHome = join(tmpdir(), `aios-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(mockHome, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(mockHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── readRegistry / writeRegistry ─────────────────────

  it("gibt leere Registry zurück wenn keine Datei existiert", () => {
    const registry = readRegistry();
    expect(registry.contexts).toEqual([]);
  });

  it("schreibt und liest Registry", () => {
    writeRegistry({
      contexts: [{
        name: "test",
        path: "/tmp/test",
        type: "project",
        description: "Test context",
        capabilities: ["code_generation"],
        last_updated: "2026-03-20T00:00:00.000Z",
      }],
    });

    const registry = readRegistry();
    expect(registry.contexts).toHaveLength(1);
    expect(registry.contexts[0].name).toBe("test");
    expect(registry.contexts[0].capabilities).toEqual(["code_generation"]);
  });

  // ─── registerContext ───────────────────────────────────

  it("registriert einen neuen Kontext", () => {
    const manifest: ContextManifest = {
      schema_version: "1.0",
      name: "new-ctx",
      description: "Neuer Kontext",
      type: "team",
      capabilities: [{ id: "analysis", description: "Analyse", input_types: ["text"], output_type: "report" }],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [],
    };

    registerContext(manifest, "/tmp/new-ctx");

    const registry = readRegistry();
    expect(registry.contexts).toHaveLength(1);
    expect(registry.contexts[0].name).toBe("new-ctx");
    expect(registry.contexts[0].type).toBe("team");
    expect(registry.contexts[0].capabilities).toEqual(["analysis"]);
  });

  it("aktualisiert bestehenden Kontext", () => {
    const manifest: ContextManifest = {
      schema_version: "1.0",
      name: "update-test",
      description: "Original",
      type: "project",
      capabilities: [],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [],
    };

    registerContext(manifest, "/tmp/update-test");
    expect(readRegistry().contexts).toHaveLength(1);

    manifest.description = "Updated";
    manifest.capabilities = [{ id: "new_cap", description: "New", input_types: [], output_type: "text" }];
    registerContext(manifest, "/tmp/update-test");

    const registry = readRegistry();
    expect(registry.contexts).toHaveLength(1);
    expect(registry.contexts[0].description).toBe("Updated");
    expect(registry.contexts[0].capabilities).toEqual(["new_cap"]);
  });

  // ─── unregisterContext ─────────────────────────────────

  it("entfernt einen Kontext aus der Registry", () => {
    const manifest: ContextManifest = {
      schema_version: "1.0",
      name: "remove-test",
      description: "Zu entfernen",
      type: "project",
      capabilities: [],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [],
    };

    registerContext(manifest, "/tmp/remove-test");
    expect(readRegistry().contexts).toHaveLength(1);

    unregisterContext("/tmp/remove-test");
    expect(readRegistry().contexts).toHaveLength(0);
  });

  // ─── buildContextCatalog ───────────────────────────────

  it("gibt Meldung zurück wenn keine Kontexte", () => {
    expect(buildContextCatalog()).toBe("Keine Kontexte registriert.");
  });

  it("baut Katalog-Text", () => {
    const manifest: ContextManifest = {
      schema_version: "1.0",
      name: "catalog-test",
      description: "Katalog-Test",
      type: "team",
      capabilities: [{ id: "review", description: "Review", input_types: ["code"], output_type: "report" }],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [],
    };

    registerContext(manifest, "/tmp/catalog-test");

    const catalog = buildContextCatalog();
    expect(catalog).toContain("catalog-test");
    expect(catalog).toContain("team");
    expect(catalog).toContain("Katalog-Test");
    expect(catalog).toContain("review");
  });
});
