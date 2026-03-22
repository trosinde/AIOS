import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { generateServiceEndpoints } from "./service-generator.js";

const TMP = join(process.cwd(), "tmp-test-generator");

beforeEach(() => {
  mkdirSync(join(TMP, ".aios"), { recursive: true });
  mkdirSync(join(TMP, "data"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("generateServiceEndpoints", () => {
  it("returns empty array when no manifest exists", () => {
    const result = generateServiceEndpoints(TMP, "test-ctx");
    expect(result).toEqual([]);
  });

  it("generates endpoints from manifest + data files", () => {
    writeFileSync(join(TMP, "data", "employees.json"), JSON.stringify([
      { name: "Max", department: "Eng" },
      { name: "Lisa", department: "HR" },
    ]));

    writeFileSync(join(TMP, "data", "manifest.yaml"), `version: "1.0"
sources:
  - file: employees.json
    name: employees
    description: "Mitarbeiter"
    key_fields: [name, department]
`);

    const result = generateServiceEndpoints(TMP, "hr");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("employees");
    expect(result[0].context).toBe("hr");
    expect(result[0].record_count).toBe(2);
    expect(result[0].key_fields).toEqual(["name", "department"]);
    expect(result[0].fields).toHaveLength(2);
    expect(result[0].last_indexed).toBeGreaterThan(0);
  });

  it("uses cache when valid", () => {
    writeFileSync(join(TMP, "data", "items.json"), '[{"id": 1}]');
    writeFileSync(join(TMP, "data", "manifest.yaml"), `version: "1.0"
sources:
  - file: items.json
    name: items
    description: "Test items"
`);

    // First call generates
    const first = generateServiceEndpoints(TMP, "test");
    expect(first).toHaveLength(1);

    // Second call should use cache (same result)
    const second = generateServiceEndpoints(TMP, "test");
    expect(second).toHaveLength(1);
    expect(second[0].name).toBe("items");
  });

  it("invalidates cache when data file is newer", async () => {
    writeFileSync(join(TMP, "data", "items.json"), '[{"id": 1}]');
    writeFileSync(join(TMP, "data", "manifest.yaml"), `version: "1.0"
sources:
  - file: items.json
    name: items
    description: "Items"
`);

    const first = generateServiceEndpoints(TMP, "test");
    expect(first[0].record_count).toBe(1);

    // Wait a bit then update data file
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(join(TMP, "data", "items.json"), '[{"id": 1}, {"id": 2}]');

    const second = generateServiceEndpoints(TMP, "test");
    expect(second[0].record_count).toBe(2);
  });

  it("skips individual sources that fail", () => {
    writeFileSync(join(TMP, "data", "good.json"), '[{"a": 1}]');
    writeFileSync(join(TMP, "data", "bad.json"), 'not-json');
    writeFileSync(join(TMP, "data", "manifest.yaml"), `version: "1.0"
sources:
  - file: good.json
    name: good
    description: "Good data"
  - file: bad.json
    name: bad
    description: "Bad data"
`);

    const result = generateServiceEndpoints(TMP, "test");
    // bad.json fails but good.json succeeds
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("good");
  });

  it("uses all fields as key_fields when not specified", () => {
    writeFileSync(join(TMP, "data", "data.json"), '[{"x": 1, "y": 2}]');
    writeFileSync(join(TMP, "data", "manifest.yaml"), `version: "1.0"
sources:
  - file: data.json
    name: data
    description: "No key fields specified"
`);

    const result = generateServiceEndpoints(TMP, "test");
    expect(result[0].key_fields).toEqual(["x", "y"]);
  });
});
