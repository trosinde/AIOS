import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { initServiceInterface } from "./service-init.js";

const TMP = join(process.cwd(), "tmp-test-service-init");

function createContext(overrides: Record<string, unknown> = {}) {
  const config = {
    schema_version: "1.0",
    name: "test-team",
    description: "Test Team",
    type: "team",
    capabilities: [],
    exports: [
      { type: "test_findings", scope: "shared", description: "Test-Ergebnisse" },
    ],
    accepts: [],
    links: [],
    config: {
      default_provider: "claude",
      patterns_dir: "./patterns",
      personas_dir: "./personas",
      knowledge_dir: "./knowledge",
    },
    ...overrides,
  };

  mkdirSync(join(TMP, ".aios"), { recursive: true });
  writeFileSync(
    join(TMP, ".aios", "context.yaml"),
    `schema_version: "1.0"\nname: ${config.name}\ndescription: "${config.description}"\ntype: ${config.type}\nexports:\n  - type: ${(config.exports as Array<{ type: string; scope: string; description: string }>)[0].type}\n    scope: shared\n    description: "${(config.exports as Array<{ type: string; scope: string; description: string }>)[0].description}"\ncapabilities: []\naccepts: []\nlinks: []\nconfig:\n  default_provider: claude\n  patterns_dir: ./patterns\n  personas_dir: ./personas\n  knowledge_dir: ./knowledge\n`,
  );
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("initServiceInterface", () => {
  it("throws when no context.yaml exists", () => {
    expect(() => initServiceInterface(TMP)).toThrow("Kein AIOS-Kontext");
  });

  it("skips when manifest already exists", () => {
    createContext();
    mkdirSync(join(TMP, "data"), { recursive: true });
    writeFileSync(join(TMP, "data", "manifest.yaml"), "version: '1.0'\nsources: []\n");

    const result = initServiceInterface(TMP);
    expect(result.manifestCreated).toBe(false);
    expect(result.message).toContain("existiert bereits");
  });

  it("detects existing data files and generates manifest", () => {
    createContext();
    mkdirSync(join(TMP, "data"), { recursive: true });
    writeFileSync(
      join(TMP, "data", "items.json"),
      JSON.stringify([{ id: "1", name: "Test", status: "ok" }]),
    );

    const result = initServiceInterface(TMP);
    expect(result.manifestCreated).toBe(true);
    expect(result.dataFilesCreated).toEqual([]);
    expect(result.sourcesDetected).toHaveLength(1);
    expect(result.sourcesDetected[0].name).toBe("items");

    // Verify manifest was written
    const manifestContent = readFileSync(join(TMP, "data", "manifest.yaml"), "utf-8");
    const manifest = parseYaml(manifestContent) as { version: string; sources: Array<{ name: string }> };
    expect(manifest.version).toBe("1.0");
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0].name).toBe("items");
  });

  it("generates template data from context exports when no data exists", () => {
    createContext();

    const result = initServiceInterface(TMP);
    expect(result.manifestCreated).toBe(true);
    expect(result.dataFilesCreated.length).toBeGreaterThan(0);
    expect(result.sourcesDetected.length).toBeGreaterThan(0);

    // Template file should exist
    expect(existsSync(join(TMP, "data", result.dataFilesCreated[0]))).toBe(true);

    // Manifest should reference the template file
    const manifestContent = readFileSync(join(TMP, "data", "manifest.yaml"), "utf-8");
    const manifest = parseYaml(manifestContent) as { sources: Array<{ file: string }> };
    expect(manifest.sources[0].file).toBe(result.dataFilesCreated[0]);
  });

  it("generates security-themed template for security exports", () => {
    createContext({
      name: "securitas",
      exports: [
        { type: "security_findings", scope: "shared", description: "Sicherheitsbefunde" },
      ],
    });

    const result = initServiceInterface(TMP);
    const dataFile = join(TMP, "data", result.dataFilesCreated[0]);
    const data = JSON.parse(readFileSync(dataFile, "utf-8")) as Array<Record<string, unknown>>;

    expect(data[0]).toHaveProperty("severity");
    expect(data[0]).toHaveProperty("component");
  });

  it("generates network-themed template for network exports", () => {
    createContext({
      name: "network",
      exports: [
        { type: "network_topology", scope: "shared", description: "Netzwerk-Topologien" },
      ],
    });

    const result = initServiceInterface(TMP);
    const dataFile = join(TMP, "data", result.dataFilesCreated[0]);
    const data = JSON.parse(readFileSync(dataFile, "utf-8")) as Array<Record<string, unknown>>;

    expect(data[0]).toHaveProperty("subnet");
    expect(data[0]).toHaveProperty("gateway");
  });

  it("creates data directory if it does not exist", () => {
    createContext();
    expect(existsSync(join(TMP, "data"))).toBe(false);

    initServiceInterface(TMP);
    expect(existsSync(join(TMP, "data"))).toBe(true);
  });

  it("ignores non-array data files during scan", () => {
    createContext();
    mkdirSync(join(TMP, "data"), { recursive: true });
    writeFileSync(join(TMP, "data", "config.json"), '{"key": "value"}');
    writeFileSync(
      join(TMP, "data", "valid.json"),
      JSON.stringify([{ a: 1 }]),
    );

    const result = initServiceInterface(TMP);
    expect(result.sourcesDetected).toHaveLength(1);
    expect(result.sourcesDetected[0].file).toBe("valid.json");
  });

  it("handles YAML data files", () => {
    createContext();
    mkdirSync(join(TMP, "data"), { recursive: true });
    writeFileSync(join(TMP, "data", "items.yaml"), "- name: Test\n  value: 42\n");

    const result = initServiceInterface(TMP);
    expect(result.sourcesDetected).toHaveLength(1);
    expect(result.sourcesDetected[0].name).toBe("items");
  });
});
