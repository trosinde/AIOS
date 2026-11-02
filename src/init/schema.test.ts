import { describe, it, expect, vi } from "vitest";
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

describe("ContextConfig round-trip completeness", () => {
  /**
   * parseContextYaml + serializeContext is the round-trip that
   * `aios init --refresh` performs. A field dropped here is a setting the
   * user loses without being told — the security block in particular, since
   * buildSecurityLayer() reads integrity_policies from it.
   */
  it("keeps security.integrity_policies across parse and serialize", () => {
    const yaml = [
      'schema_version: "1.0"',
      "name: forensics-workspace",
      "type: project",
      "security:",
      "  integrity_policies: strict",
      "",
    ].join("\n");

    const parsed = parseContextYaml(yaml);
    expect(parsed.security?.integrity_policies).toBe("strict");

    const reparsed = parseContextYaml(serializeContext(parsed));
    expect(reparsed.security?.integrity_policies).toBe("strict");
  });

  it("keeps the security codeshield allow/deny lists", () => {
    const yaml = [
      'schema_version: "1.0"',
      "name: ws",
      "security:",
      "  integrity_policies: strict",
      "  codeshield:",
      "    allowList:",
      // Quoted on purpose: a CodeShield prefix normally ends in a space
      // ("git " must not match "gitx"), and YAML strips a trailing space
      // from a plain scalar.
      '      - "git "',
      "    denyList:",
      "      - rm -rf /",
      "",
    ].join("\n");
    const reparsed = parseContextYaml(serializeContext(parseContextYaml(yaml)));
    expect(reparsed.security?.codeshield?.allowList).toEqual(["git "]);
    expect(reparsed.security?.codeshield?.denyList).toEqual(["rm -rf /"]);
  });

  it("drops an unknown integrity_policies value and says so", () => {
    // A typo in the one flag that turns integrity checks on used to pass the
    // cast, fail the === "strict" comparison, and leave an empty policy set
    // with no diagnostic — a security flag failing open in silence.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const parsed = parseContextYaml(
        'schema_version: "1.0"\nname: ws\nsecurity:\n  integrity_policies: Strict\n',
      );
      expect(parsed.security?.integrity_policies).toBeUndefined();
      expect(warn.mock.calls.flat().join(" ")).toMatch(/integrity_policies="Strict" ist unbekannt/);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about an unknown key inside security", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      parseContextYaml(
        'schema_version: "1.0"\nname: ws\nsecurity:\n  integrity_polices: strict\n',
      );
      expect(warn.mock.calls.flat().join(" ")).toMatch(/security\.integrity_polices ist kein bekannter Schlüssel/);
    } finally {
      warn.mockRestore();
    }
  });

  it("accepts relaxed without complaint", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const parsed = parseContextYaml(
        'schema_version: "1.0"\nname: ws\nsecurity:\n  integrity_policies: relaxed\n',
      );
      expect(parsed.security?.integrity_policies).toBe("relaxed");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("leaves security absent when the input has none", () => {
    const parsed = parseContextYaml('schema_version: "1.0"\nname: ws\n');
    expect(parsed.security).toBeUndefined();
  });
});
