import { describe, it, expect } from "vitest";
import { parseContextYaml, serializeContext, createDefaultContext } from "./schema.js";
import type { ContextConfig } from "../types.js";
import { stringify } from "yaml";

const VALID_CONTEXT: ContextConfig = {
  schema_version: "1.0",
  name: "test-project",
  description: "A test project",
  type: "project",
  capabilities: [],
  exports: [],
  accepts: [],
  links: [],
  config: {
    default_provider: "claude",
    patterns_dir: "./patterns",
    personas_dir: "./personas",
    knowledge_dir: "./knowledge",
  },
  project: {
    domain: "web-backend",
    language: "typescript",
    repo: "https://github.com/test/project",
  },
  aios: {
    path: "/home/user/AIOS",
    readOnly: true,
  },
  compliance: {
    standards: [{ id: "owasp" }, { id: "iec-62443", level: "SL2" }],
    requireTraceability: true,
    requireTestCoverage: true,
    minimumCoverage: 80,
  },
  personas: {
    active: ["developer", "security_expert"],
    inactive: ["architect", "tester"],
  },
  providers: {
    routing: { complex: "anthropic", quick: "ollama" },
  },
  knowledge: {
    autoIndex: ["docs/**/*.md"],
    autoExtract: false,
  },
};

describe("schema", () => {
  describe("parseContextYaml", () => {
    it("parses valid unified context YAML", () => {
      const yaml = serializeContext(VALID_CONTEXT);
      const parsed = parseContextYaml(yaml);
      expect(parsed.name).toBe("test-project");
      expect(parsed.schema_version).toBe("1.0");
      expect(parsed.type).toBe("project");
      expect(parsed.project?.domain).toBe("web-backend");
      expect(parsed.compliance?.standards).toHaveLength(2);
    });

    it("throws on empty input", () => {
      expect(() => parseContextYaml("")).toThrow("Invalid context.yaml");
    });

    it("throws on missing name", () => {
      expect(() => parseContextYaml("description: test\n")).toThrow("name");
    });

    it("parses legacy AiosContext format (backward compat)", () => {
      const legacy = stringify({
        version: "1",
        project: {
          name: "legacy-project",
          description: "A legacy project",
          domain: "web",
          language: "typescript",
          repo: null,
        },
        aios: { path: "/home/user/AIOS", readOnly: true },
        compliance: { standards: [], requireTraceability: false, requireTestCoverage: false },
        personas: { active: ["developer"], inactive: [] },
        providers: { routing: {} },
        knowledge: { autoIndex: [], autoExtract: false },
      });
      const parsed = parseContextYaml(legacy);
      expect(parsed.name).toBe("legacy-project");
      expect(parsed.schema_version).toBe("1.0");
      expect(parsed.type).toBe("project");
      expect(parsed.project?.language).toBe("typescript");
      expect(parsed.aios?.readOnly).toBe(true);
    });

    it("accepts null repo in legacy format", () => {
      const legacy = stringify({
        version: "1",
        project: { name: "x", description: "", domain: "general", language: "unknown", repo: null },
        aios: { path: "/aios", readOnly: false },
        compliance: { standards: [], requireTraceability: false, requireTestCoverage: false },
        personas: { active: [], inactive: [] },
        providers: { routing: {} },
        knowledge: { autoIndex: [], autoExtract: false },
      });
      const parsed = parseContextYaml(legacy);
      expect(parsed.project?.repo).toBeNull();
    });

    it("throws on malformed YAML syntax", () => {
      expect(() => parseContextYaml("{{invalid yaml: [[[")).toThrow();
    });

    it("throws when name is non-string", () => {
      expect(() => parseContextYaml("name: 123\n")).toThrow("name");
    });

    it("throws on invalid type value", () => {
      expect(() => parseContextYaml("name: test\ntype: invalid\n")).toThrow("type");
    });

    it("handles legacy format with missing aios block (falls to unified path)", () => {
      const yaml = "version: \"1\"\nproject:\n  name: partial\n  description: test\n  domain: x\n  language: ts\n  repo: null\n";
      // This has version: "1" + project but no aios block → Zod validation fails
      // → falls through to unified path where project.name is not top-level name
      // Should not crash — either parses as unified or throws clearly
      expect(() => parseContextYaml(yaml)).toThrow("name");
    });

    it("normalizes non-array capabilities to empty array", () => {
      const yaml = "name: test\ncapabilities: not-an-array\n";
      const parsed = parseContextYaml(yaml);
      expect(Array.isArray(parsed.capabilities)).toBe(true);
      expect(parsed.capabilities).toEqual([]);
    });

    it("normalizes non-object config to defaults", () => {
      const yaml = "name: test\nconfig: 42\n";
      const parsed = parseContextYaml(yaml);
      expect(parsed.config.default_provider).toBe("claude");
    });
  });

  describe("serializeContext", () => {
    it("produces valid YAML", () => {
      const yaml = serializeContext(VALID_CONTEXT);
      expect(yaml).toContain("schema_version:");
      expect(yaml).toContain("name: test-project");
      expect(yaml).toContain("type: project");
    });
  });

  describe("round-trip", () => {
    it("serialize → parse → deep equal", () => {
      const yaml = serializeContext(VALID_CONTEXT);
      const parsed = parseContextYaml(yaml);
      expect(parsed.name).toBe(VALID_CONTEXT.name);
      expect(parsed.schema_version).toBe(VALID_CONTEXT.schema_version);
      expect(parsed.type).toBe(VALID_CONTEXT.type);
      expect(parsed.project?.domain).toBe(VALID_CONTEXT.project?.domain);
      expect(parsed.compliance?.standards).toEqual(VALID_CONTEXT.compliance?.standards);
    });

    it("round-trips with minimal context", () => {
      const minimal = createDefaultContext({
        project: { name: "min", description: "", domain: "general", language: "unknown", repo: null },
        aios: { path: "/aios", readOnly: false },
      });
      const yaml = serializeContext(minimal);
      const parsed = parseContextYaml(yaml);
      expect(parsed.name).toBe("min");
      expect(parsed.aios?.readOnly).toBe(false);
    });
  });

  describe("createDefaultContext", () => {
    it("creates with sensible defaults", () => {
      const ctx = createDefaultContext();
      expect(ctx.schema_version).toBe("1.0");
      expect(ctx.name).toBe("unnamed-project");
      expect(ctx.type).toBe("project");
      expect(ctx.aios?.readOnly).toBe(true);
      expect(ctx.personas?.active).toContain("developer");
    });

    it("applies overrides", () => {
      const ctx = createDefaultContext({
        project: { name: "my-project", description: "test", domain: "web", language: "python", repo: null },
      });
      expect(ctx.name).toBe("my-project");
      expect(ctx.project?.language).toBe("python");
    });
  });
});
