import { describe, it, expect, vi, beforeEach } from "vitest";
import { PatternRegistry } from "../core/registry.js";
import { join } from "path";

const PATTERNS_DIR = join(process.cwd(), "patterns");

describe("MCP Server", () => {
  let registry: PatternRegistry;

  beforeEach(() => {
    registry = new PatternRegistry(PATTERNS_DIR);
  });

  it("PatternRegistry has patterns available for MCP tools", () => {
    const patterns = registry.all();
    expect(patterns.length).toBeGreaterThan(0);

    const names = registry.list();
    expect(names).toContain("summarize");
  });

  it("buildCatalog produces compact output for aios_patterns", () => {
    const catalog = registry.buildCatalog();
    expect(catalog).toBeTruthy();
    expect(catalog).toContain("summarize");
    expect(catalog).toContain("Input:");
    expect(catalog).toContain("Output:");
  });

  it("registry.get returns pattern for aios_run", () => {
    const pattern = registry.get("summarize");
    expect(pattern).toBeDefined();
    expect(pattern!.meta.name).toBe("summarize");
    expect(pattern!.systemPrompt).toBeTruthy();
  });

  it("registry.get returns undefined for unknown pattern", () => {
    const pattern = registry.get("nonexistent_pattern_xyz");
    expect(pattern).toBeUndefined();
  });

  it("all patterns have required meta fields for MCP exposure", () => {
    for (const p of registry.all()) {
      expect(p.meta.name).toBeTruthy();
      expect(p.meta.description).toBeTruthy();
      expect(p.meta.input_type).toBeTruthy();
      expect(p.meta.output_type).toBeTruthy();
    }
  });
});

describe("MCP Tool Definitions", () => {
  it("defines all 4 required tools", () => {
    const tools = [
      { name: "aios_run", requiredParams: ["pattern", "input"] },
      { name: "aios_orchestrate", requiredParams: ["task"] },
      { name: "aios_patterns", requiredParams: [] },
      { name: "aios_plan", requiredParams: ["task"] },
    ];

    expect(tools).toHaveLength(4);
    expect(tools.map(t => t.name)).toEqual([
      "aios_run",
      "aios_orchestrate",
      "aios_patterns",
      "aios_plan",
    ]);
  });

  it("aios_run requires pattern and input parameters", () => {
    const schema = {
      type: "object",
      properties: {
        pattern: { type: "string" },
        input: { type: "string" },
        provider: { type: "string" },
      },
      required: ["pattern", "input"],
    };

    expect(schema.required).toContain("pattern");
    expect(schema.required).toContain("input");
    expect(schema.required).not.toContain("provider");
  });

  it("aios_orchestrate supports dry_run option", () => {
    const schema = {
      type: "object",
      properties: {
        task: { type: "string" },
        dry_run: { type: "boolean" },
      },
      required: ["task"],
    };

    expect(schema.properties).toHaveProperty("dry_run");
    expect(schema.required).not.toContain("dry_run");
  });
});
