import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { queryService } from "./query-engine.js";
import type { ServiceEndpoint } from "../types.js";

const TMP = join(process.cwd(), "tmp-test-query");

const EMPLOYEES = [
  { name: "Max Mustermann", personnel_number: "P-1042", department: "Engineering", email: "max@firma.de" },
  { name: "Lisa Schmidt", personnel_number: "P-1078", department: "HR", email: "lisa@firma.de" },
  { name: "Tom Müller", personnel_number: "P-1099", department: "Engineering", email: "tom@firma.de" },
];

function makeEndpoint(): ServiceEndpoint {
  return {
    name: "employees",
    description: "Mitarbeiterverzeichnis",
    context: "hr",
    data_file: "employees.json",
    fields: [
      { name: "name", type: "string" },
      { name: "personnel_number", type: "string" },
      { name: "department", type: "string" },
      { name: "email", type: "string" },
    ],
    key_fields: ["name", "personnel_number", "department"],
    record_count: 3,
    last_indexed: Date.now(),
  };
}

beforeEach(() => {
  mkdirSync(join(TMP, "data"), { recursive: true });
  writeFileSync(join(TMP, "data", "employees.json"), JSON.stringify(EMPLOYEES));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("queryService", () => {
  it("finds exact match by personnel_number", async () => {
    const result = await queryService(makeEndpoint(), { personnel_number: "P-1042" }, TMP);
    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Max Mustermann");
  });

  it("finds case-insensitive substring match by name", async () => {
    const result = await queryService(makeEndpoint(), { name: "lisa" }, TMP);
    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Lisa Schmidt");
  });

  it("finds multiple matches by department", async () => {
    const result = await queryService(makeEndpoint(), { department: "Engineering" }, TMP);
    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(2);
  });

  it("returns empty results when no match", async () => {
    const result = await queryService(makeEndpoint(), { name: "Nonexistent" }, TMP);
    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(0);
  });

  it("returns empty results when query uses non-key fields", async () => {
    const result = await queryService(makeEndpoint(), { email: "max@firma.de" }, TMP);
    // email is not in key_fields, so direct search should not match
    expect(result.results).toHaveLength(0);
  });

  it("combines multiple query fields with AND logic", async () => {
    const result = await queryService(
      makeEndpoint(),
      { name: "Max", department: "Engineering" },
      TMP,
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Max Mustermann");
  });

  it("returns correct metadata in result", async () => {
    const result = await queryService(makeEndpoint(), { name: "Lisa" }, TMP);
    expect(result.endpoint).toBe("employees");
    expect(result.context).toBe("hr");
    expect(result.query).toEqual({ name: "Lisa" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
