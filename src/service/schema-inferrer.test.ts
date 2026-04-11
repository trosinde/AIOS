import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { inferSchema, loadDataFile } from "./schema-inferrer.js";

const TMP = join(process.cwd(), "tmp-test-schema");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("inferSchema", () => {
  it("infers fields from a JSON array", () => {
    const file = join(TMP, "data.json");
    writeFileSync(file, JSON.stringify([
      { name: "Max", age: 30, active: true },
      { name: "Lisa", age: 25, active: false },
    ]));

    const result = inferSchema(file);
    expect(result.recordCount).toBe(2);
    expect(result.fields).toHaveLength(3);
    expect(result.fields[0]).toMatchObject({ name: "name", type: "string" });
    expect(result.fields[1]).toMatchObject({ name: "age", type: "number" });
    expect(result.fields[2]).toMatchObject({ name: "active", type: "boolean" });
  });

  it("infers fields from a YAML array", () => {
    const file = join(TMP, "data.yaml");
    writeFileSync(file, `- name: Max
  department: Engineering
- name: Lisa
  department: HR
`);

    const result = inferSchema(file);
    expect(result.recordCount).toBe(2);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]).toMatchObject({ name: "name", type: "string" });
    expect(result.fields[1]).toMatchObject({ name: "department", type: "string" });
  });

  it("handles empty arrays", () => {
    const file = join(TMP, "empty.json");
    writeFileSync(file, "[]");

    const result = inferSchema(file);
    expect(result.recordCount).toBe(0);
    expect(result.fields).toEqual([]);
  });

  it("throws on non-array data", () => {
    const file = join(TMP, "obj.json");
    writeFileSync(file, '{"key": "value"}');

    expect(() => inferSchema(file)).toThrow("Array von Objekten");
  });

  it("handles nested objects", () => {
    const file = join(TMP, "nested.json");
    writeFileSync(file, JSON.stringify([
      { name: "Max", address: { city: "Berlin" }, tags: ["a", "b"] },
    ]));

    const result = inferSchema(file);
    expect(result.fields.find((f) => f.name === "address")?.type).toBe("object");
    expect(result.fields.find((f) => f.name === "tags")?.type).toBe("array");
  });

  it("provides sample values", () => {
    const file = join(TMP, "samples.json");
    writeFileSync(file, JSON.stringify([
      { name: "Max Mustermann", count: 42 },
    ]));

    const result = inferSchema(file);
    expect(result.fields[0].sample).toBe("Max Mustermann");
    expect(result.fields[1].sample).toBe("42");
  });
});

describe("loadDataFile", () => {
  it("loads JSON data", () => {
    const file = join(TMP, "load.json");
    writeFileSync(file, JSON.stringify([{ a: 1 }, { a: 2 }]));

    const data = loadDataFile(file);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ a: 1 });
  });

  it("loads YAML data", () => {
    const file = join(TMP, "load.yaml");
    writeFileSync(file, "- x: hello\n- x: world\n");

    const data = loadDataFile(file);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ x: "hello" });
  });
});
