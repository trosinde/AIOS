import { describe, it, expect } from "vitest";
import { parseContextYaml, serializeContext, createDefaultContext } from "./schema.js";
import type { AiosContext } from "./schema.js";

const VALID_CONTEXT: AiosContext = {
  version: "1",
  project: {
    name: "test-project",
    description: "A test project",
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
    it("parses valid context YAML", () => {
      const yaml = serializeContext(VALID_CONTEXT);
      const parsed = parseContextYaml(yaml);
      expect(parsed).toEqual(VALID_CONTEXT);
    });

    it("throws on empty input", () => {
      expect(() => parseContextYaml("")).toThrow("Invalid context.yaml");
    });

    it("throws on missing required fields", () => {
      expect(() => parseContextYaml("version: '1'\n")).toThrow("Invalid context.yaml");
    });

    it("throws on wrong version", () => {
      const yaml = serializeContext(VALID_CONTEXT).replace("version: \"1\"", "version: \"2\"");
      expect(() => parseContextYaml(yaml)).toThrow();
    });

    it("throws on missing project name", () => {
      const ctx = { ...VALID_CONTEXT, project: { ...VALID_CONTEXT.project, name: "" } };
      const yaml = serializeContext({ ...ctx, project: { ...ctx.project, name: "x" } })
        .replace("name: x", "name: \"\"");
      expect(() => parseContextYaml(yaml)).toThrow();
    });

    it("accepts null repo", () => {
      const ctx: AiosContext = {
        ...VALID_CONTEXT,
        project: { ...VALID_CONTEXT.project, repo: null },
      };
      const yaml = serializeContext(ctx);
      const parsed = parseContextYaml(yaml);
      expect(parsed.project.repo).toBeNull();
    });

    it("accepts empty compliance standards", () => {
      const ctx: AiosContext = {
        ...VALID_CONTEXT,
        compliance: { standards: [], requireTraceability: false, requireTestCoverage: false },
      };
      const yaml = serializeContext(ctx);
      const parsed = parseContextYaml(yaml);
      expect(parsed.compliance.standards).toEqual([]);
    });
  });

  describe("serializeContext", () => {
    it("produces valid YAML", () => {
      const yaml = serializeContext(VALID_CONTEXT);
      expect(yaml).toContain("version:");
      expect(yaml).toContain("project:");
      expect(yaml).toContain("test-project");
    });

    it("throws on invalid context", () => {
      const invalid = { ...VALID_CONTEXT, version: "99" } as unknown as AiosContext;
      expect(() => serializeContext(invalid)).toThrow();
    });
  });

  describe("round-trip", () => {
    it("serialize → parse → deep equal", () => {
      const yaml = serializeContext(VALID_CONTEXT);
      const parsed = parseContextYaml(yaml);
      expect(parsed).toEqual(VALID_CONTEXT);
    });

    it("round-trips with minimal context", () => {
      const minimal = createDefaultContext({
        project: { name: "min", description: "", domain: "general", language: "unknown", repo: null },
        aios: { path: "/aios", readOnly: false },
      });
      const yaml = serializeContext(minimal);
      const parsed = parseContextYaml(yaml);
      expect(parsed).toEqual(minimal);
    });
  });

  describe("createDefaultContext", () => {
    it("creates with sensible defaults", () => {
      const ctx = createDefaultContext();
      expect(ctx.version).toBe("1");
      expect(ctx.project.name).toBe("unnamed-project");
      expect(ctx.aios.readOnly).toBe(true);
      expect(ctx.personas.active).toContain("developer");
    });

    it("applies overrides", () => {
      const ctx = createDefaultContext({
        project: { name: "my-project", description: "test", domain: "web", language: "python", repo: null },
      });
      expect(ctx.project.name).toBe("my-project");
      expect(ctx.project.language).toBe("python");
    });
  });
});
