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

// Import after mock – types can be imported statically (not affected by vi.mock)
import type { RegistryEntry } from "./registry.js";
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
        links: [],
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

  // ─── Links in Registry ──────────────────────────────────

  it("speichert Links bei registerContext", () => {
    const manifest: ContextManifest = {
      schema_version: "1.0",
      name: "securitas",
      description: "Security-Team",
      type: "team",
      capabilities: [{ id: "security_audit", description: "Audits", input_types: ["code"], output_type: "report" }],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [
        { name: "network", path: "/tmp/network", relationship: "consults" },
      ],
    };

    registerContext(manifest, "/tmp/securitas");

    const registry = readRegistry();
    expect(registry.contexts).toHaveLength(1);
    expect(registry.contexts[0].links).toHaveLength(1);
    expect(registry.contexts[0].links![0].name).toBe("network");
    expect(registry.contexts[0].links![0].relationship).toBe("consults");
  });

  it("zeigt Links im Katalog-Text", () => {
    const securitas: ContextManifest = {
      schema_version: "1.0",
      name: "securitas",
      description: "Security-Team",
      type: "team",
      capabilities: [{ id: "security_audit", description: "Audits", input_types: ["code"], output_type: "report" }],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [{ name: "network", path: "/tmp/network", relationship: "consults" }],
    };

    const network: ContextManifest = {
      schema_version: "1.0",
      name: "network",
      description: "Network-Team",
      type: "team",
      capabilities: [{ id: "network_design", description: "Netzwerk-Design", input_types: ["requirements"], output_type: "design" }],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [{ name: "securitas", path: "/tmp/securitas", relationship: "consults" }],
    };

    registerContext(securitas, "/tmp/securitas");
    registerContext(network, "/tmp/network");

    const catalog = buildContextCatalog();
    expect(catalog).toContain("securitas");
    expect(catalog).toContain("network");
    expect(catalog).toContain("network (consults)");
    expect(catalog).toContain("securitas (consults)");
  });

  it("aktualisiert Links bei erneutem registerContext", () => {
    const manifest: ContextManifest = {
      schema_version: "1.0",
      name: "team-a",
      description: "Team A",
      type: "team",
      capabilities: [],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [],
    };

    registerContext(manifest, "/tmp/team-a");
    expect(readRegistry().contexts[0].links).toEqual([]);

    manifest.links = [{ name: "team-b", path: "/tmp/team-b", relationship: "audits" }];
    registerContext(manifest, "/tmp/team-a");

    const registry = readRegistry();
    expect(registry.contexts).toHaveLength(1);
    expect(registry.contexts[0].links).toHaveLength(1);
    expect(registry.contexts[0].links![0].relationship).toBe("audits");
  });

  it("liest Registry-Einträge ohne links-Feld (Rückwärtskompatibilität)", () => {
    writeRegistry({
      contexts: [{
        name: "legacy",
        path: "/tmp/legacy",
        type: "project",
        description: "Legacy entry ohne links",
        capabilities: ["code_generation"],
        last_updated: "2026-01-01T00:00:00.000Z",
      } as RegistryEntry],
    });

    const catalog = buildContextCatalog();
    expect(catalog).toContain("legacy");
    expect(catalog).toContain("keine");
  });

  it("Katalog zeigt 'keine' wenn Kontext ohne Links", () => {
    const manifest: ContextManifest = {
      schema_version: "1.0",
      name: "lone-wolf",
      description: "Alleinstehender Kontext",
      type: "project",
      capabilities: [],
      exports: [],
      accepts: [],
      config: { default_provider: "claude", patterns_dir: "./patterns", personas_dir: "./personas", knowledge_dir: "./knowledge" },
      links: [],
    };

    registerContext(manifest, "/tmp/lone-wolf");
    const catalog = buildContextCatalog();
    expect(catalog).toContain("keine");
  });
});
