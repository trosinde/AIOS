import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  findFirstJsonObject,
  extractMemoryItems,
  loadMempalaceConfig,
  parseDuplicateResponse,
  formatSummary,
  type MemoryItem,
  type PersistResult,
} from "./mempalace-persist.js";

describe("findFirstJsonObject", () => {
  it("extracts a plain JSON object", () => {
    const input = `{"memory_items":[]}`;
    expect(findFirstJsonObject(input)).toBe(`{"memory_items":[]}`);
  });

  it("ignores prose before the JSON", () => {
    const input = `Here is the result:\n\n{"a":1}\n`;
    expect(findFirstJsonObject(input)).toBe(`{"a":1}`);
  });

  it("ignores markdown code fences and header wrapping", () => {
    const input = [
      "## structured (von memory_store)",
      "> Zusammenfassung: 2 items",
      "### Details",
      "",
      "```json",
      `{"memory_items":[{"wing":"w","room":"r","type":"fact","content":"c"}]}`,
      "```",
    ].join("\n");
    const extracted = findFirstJsonObject(input);
    expect(extracted).toContain(`"memory_items"`);
    expect(() => JSON.parse(extracted!)).not.toThrow();
  });

  it("handles nested objects correctly", () => {
    const input = `noise {"a":{"b":{"c":1}},"d":2} more noise`;
    const extracted = findFirstJsonObject(input);
    expect(extracted).toBe(`{"a":{"b":{"c":1}},"d":2}`);
  });

  it("does not confuse braces inside strings", () => {
    const input = `{"text":"a } b { c","ok":true}`;
    expect(findFirstJsonObject(input)).toBe(input);
  });

  it("handles escaped quotes in strings", () => {
    const input = `{"text":"he said \\"hi\\"","ok":true}`;
    expect(findFirstJsonObject(input)).toBe(input);
  });

  it("returns null when no JSON is present", () => {
    expect(findFirstJsonObject("just prose, no json here")).toBeNull();
  });

  it("returns null for an unbalanced object", () => {
    expect(findFirstJsonObject(`{"a":1`)).toBeNull();
  });
});

describe("extractMemoryItems", () => {
  const validItem = {
    wing: "wing_aios_decisions",
    room: "mcp_integration",
    type: "decision",
    content: "Wir nutzen MCP statt direktem Python-SDK für zero coupling.",
    relevance: "high",
    tags: ["architecture", "mcp"],
  };

  it("parses a well-formed memory_items array", () => {
    const input = JSON.stringify({ memory_items: [validItem] });
    const items = extractMemoryItems(input);
    expect(items).toHaveLength(1);
    expect(items[0].wing).toBe("wing_aios_decisions");
    expect(items[0].type).toBe("decision");
    expect(items[0].tags).toEqual(["architecture", "mcp"]);
  });

  it("handles wrapped markdown input", () => {
    const input = [
      "## structured (von memory_store)",
      "### Details",
      "",
      JSON.stringify({ memory_items: [validItem] }),
    ].join("\n");
    const items = extractMemoryItems(input);
    expect(items).toHaveLength(1);
  });

  it("returns empty list for empty memory_items array", () => {
    const items = extractMemoryItems(`{"memory_items":[]}`);
    expect(items).toEqual([]);
  });

  it("throws if no JSON is present", () => {
    expect(() => extractMemoryItems("just prose")).toThrow(/kein JSON-Objekt/);
  });

  it("throws if memory_items field is missing", () => {
    expect(() => extractMemoryItems(`{"something_else":[]}`)).toThrow(/memory_items/);
  });

  it("throws if memory_items is not an array", () => {
    expect(() => extractMemoryItems(`{"memory_items":"nope"}`)).toThrow(/memory_items/);
  });

  it("throws on item with missing wing", () => {
    const input = JSON.stringify({
      memory_items: [{ ...validItem, wing: "" }],
    });
    expect(() => extractMemoryItems(input)).toThrow(/wing/);
  });

  it("throws on item with missing content", () => {
    const input = JSON.stringify({
      memory_items: [{ ...validItem, content: "" }],
    });
    expect(() => extractMemoryItems(input)).toThrow(/content/);
  });

  it("throws on item with invalid type", () => {
    const input = JSON.stringify({
      memory_items: [{ ...validItem, type: "rumor" }],
    });
    expect(() => extractMemoryItems(input)).toThrow(/type/);
  });

  it("ignores unknown relevance and non-string tags", () => {
    const input = JSON.stringify({
      memory_items: [{ ...validItem, relevance: "bogus", tags: ["ok", 42, null] }],
    });
    const items = extractMemoryItems(input);
    expect(items[0].relevance).toBeUndefined();
    expect(items[0].tags).toEqual(["ok"]);
  });

  it("accepts all five memory types", () => {
    const types = ["decision", "fact", "finding", "pattern", "lesson"] as const;
    for (const t of types) {
      const input = JSON.stringify({
        memory_items: [{ ...validItem, type: t }],
      });
      const items = extractMemoryItems(input);
      expect(items[0].type).toBe(t);
    }
  });
});

describe("loadMempalaceConfig", () => {
  let dir: string;

  function cleanup(): void {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }

  it("returns defaults when aios.yaml is absent", () => {
    dir = mkdtempSync(join(tmpdir(), "mempalace-cfg-"));
    try {
      const cfg = loadMempalaceConfig(dir);
      expect(cfg.command).toBe("python");
      expect(cfg.args).toEqual(["-m", "mempalace.mcp_server"]);
    } finally {
      cleanup();
    }
  });

  it("reads command/args/env from mcp.servers.mempalace", () => {
    dir = mkdtempSync(join(tmpdir(), "mempalace-cfg-"));
    try {
      writeFileSync(join(dir, "aios.yaml"), [
        "mcp:",
        "  servers:",
        "    mempalace:",
        "      command: custom-python",
        "      args: [\"-m\", \"my.mempalace\"]",
        "      env:",
        "        MEMPALACE_DB: /tmp/mp",
      ].join("\n"));
      const cfg = loadMempalaceConfig(dir);
      expect(cfg.command).toBe("custom-python");
      expect(cfg.args).toEqual(["-m", "my.mempalace"]);
      expect(cfg.env?.MEMPALACE_DB).toBe("/tmp/mp");
    } finally {
      cleanup();
    }
  });

  it("falls back to defaults when mempalace block is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "mempalace-cfg-"));
    try {
      writeFileSync(join(dir, "aios.yaml"), "mcp:\n  servers: {}\n");
      const cfg = loadMempalaceConfig(dir);
      expect(cfg.command).toBe("python");
    } finally {
      cleanup();
    }
  });

  it("falls back to defaults on malformed YAML", () => {
    dir = mkdtempSync(join(tmpdir(), "mempalace-cfg-"));
    try {
      writeFileSync(join(dir, "aios.yaml"), "this: [: : : not yaml");
      const cfg = loadMempalaceConfig(dir);
      expect(cfg.command).toBe("python");
      expect(cfg.args).toEqual(["-m", "mempalace.mcp_server"]);
    } finally {
      cleanup();
    }
  });
});

describe("parseDuplicateResponse", () => {
  function mcpResponse(text: string) {
    return { content: [{ type: "text", text }] };
  }

  it("detects boolean true in JSON response", () => {
    expect(parseDuplicateResponse(mcpResponse("true"))).toBe(true);
    expect(parseDuplicateResponse(mcpResponse("false"))).toBe(false);
  });

  it("reads the duplicate flag from an object response", () => {
    expect(parseDuplicateResponse(mcpResponse(`{"duplicate":true}`))).toBe(true);
    expect(parseDuplicateResponse(mcpResponse(`{"duplicate":false}`))).toBe(false);
  });

  it("reads alternative flag names (is_duplicate, exists, found)", () => {
    expect(parseDuplicateResponse(mcpResponse(`{"is_duplicate":true}`))).toBe(true);
    expect(parseDuplicateResponse(mcpResponse(`{"exists":true}`))).toBe(true);
    expect(parseDuplicateResponse(mcpResponse(`{"found":true}`))).toBe(true);
  });

  it("falls back to textual hints when non-JSON", () => {
    expect(parseDuplicateResponse(mcpResponse("This is a duplicate entry"))).toBe(true);
    expect(parseDuplicateResponse(mcpResponse("Entry already exists"))).toBe(true);
    expect(parseDuplicateResponse(mcpResponse("Fresh entry"))).toBe(false);
  });

  it("returns false for malformed responses", () => {
    expect(parseDuplicateResponse(null)).toBe(false);
    expect(parseDuplicateResponse(undefined)).toBe(false);
    expect(parseDuplicateResponse({})).toBe(false);
    expect(parseDuplicateResponse({ content: [] })).toBe(false);
  });
});

describe("formatSummary", () => {
  it("formats a successful result", () => {
    const res: PersistResult = {
      total: 3,
      stored: 2,
      duplicates: 1,
      failed: 0,
      errors: [],
    };
    const out = formatSummary(res);
    expect(out).toContain("Stored:       2");
    expect(out).toContain("Duplicates:   1");
    expect(out).toContain("Failed:       0");
    expect(out).not.toContain("## Errors");
  });

  it("includes skipped_reason when present", () => {
    const res: PersistResult = {
      total: 0,
      stored: 0,
      duplicates: 0,
      failed: 0,
      skipped_reason: "MemPalace nicht erreichbar",
      errors: [],
    };
    const out = formatSummary(res);
    expect(out).toContain("Skipped:      MemPalace nicht erreichbar");
  });

  it("lists up to 10 errors and truncates the rest", () => {
    const errors = Array.from({ length: 15 }, (_, i) => `error ${i}`);
    const res: PersistResult = {
      total: 15,
      stored: 0,
      duplicates: 0,
      failed: 15,
      errors,
    };
    const out = formatSummary(res);
    expect(out).toContain("## Errors");
    expect(out).toContain("- error 0");
    expect(out).toContain("- error 9");
    expect(out).not.toContain("- error 10");
    expect(out).toContain("5 weitere unterdrückt");
  });

  it("produces valid markdown without control chars", () => {
    const res: PersistResult = {
      total: 1, stored: 1, duplicates: 0, failed: 0, errors: [],
    };
    const out = formatSummary(res);
    expect(out.startsWith("# MemPalace Persist")).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
  });
});
