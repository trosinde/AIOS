import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { parseDataManifest } from "./manifest-parser.js";

const TMP = join(process.cwd(), "tmp-test-manifest");

beforeEach(() => {
  mkdirSync(join(TMP, "data"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("parseDataManifest", () => {
  it("returns null when no manifest exists", () => {
    expect(parseDataManifest(TMP)).toBeNull();
  });

  it("parses a valid manifest", () => {
    writeFileSync(join(TMP, "data", "employees.json"), '[{"name": "Max"}]');
    writeFileSync(
      join(TMP, "data", "manifest.yaml"),
      `version: "1.0"
sources:
  - file: employees.json
    name: employees
    description: "Mitarbeiterverzeichnis"
    key_fields: [name, email]
`,
    );

    const result = parseDataManifest(TMP);
    expect(result).not.toBeNull();
    expect(result!.version).toBe("1.0");
    expect(result!.sources).toHaveLength(1);
    expect(result!.sources[0].name).toBe("employees");
    expect(result!.sources[0].key_fields).toEqual(["name", "email"]);
  });

  it("throws on invalid version", () => {
    writeFileSync(
      join(TMP, "data", "manifest.yaml"),
      `version: "2.0"
sources: []
`,
    );
    expect(() => parseDataManifest(TMP)).toThrow('version muss "1.0" sein');
  });

  it("throws on empty sources", () => {
    writeFileSync(
      join(TMP, "data", "manifest.yaml"),
      `version: "1.0"
sources: []
`,
    );
    expect(() => parseDataManifest(TMP)).toThrow("nicht-leeres Array");
  });

  it("throws when referenced file does not exist", () => {
    writeFileSync(
      join(TMP, "data", "manifest.yaml"),
      `version: "1.0"
sources:
  - file: nonexistent.json
    name: test
    description: "Test"
`,
    );
    expect(() => parseDataManifest(TMP)).toThrow("existiert nicht");
  });

  it("throws on missing name field", () => {
    writeFileSync(join(TMP, "data", "data.json"), "[]");
    writeFileSync(
      join(TMP, "data", "manifest.yaml"),
      `version: "1.0"
sources:
  - file: data.json
    description: "Test"
`,
    );
    expect(() => parseDataManifest(TMP)).toThrow("'name' Feld");
  });

  it("rejects path traversal in file references", () => {
    writeFileSync(
      join(TMP, "data", "manifest.yaml"),
      `version: "1.0"
sources:
  - file: ../../etc/passwd
    name: evil
    description: "Path traversal"
`,
    );
    expect(() => parseDataManifest(TMP)).toThrow();
  });
});
