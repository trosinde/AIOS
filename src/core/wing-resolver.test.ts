import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadWingConfig,
  resolveWing,
  resolveItemWing,
  DEFAULT_WINGS,
} from "./wing-resolver.js";

describe("wing-resolver", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "aios-wing-test-"));
  });

  afterEach(() => {
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function writeContextYaml(content: string) {
    mkdirSync(join(projectDir, ".aios"), { recursive: true });
    writeFileSync(join(projectDir, ".aios", "context.yaml"), content, "utf-8");
  }

  // ─── loadWingConfig ──────────────────────────────────

  it("returns defaults when no context.yaml is present", () => {
    const cfg = loadWingConfig(projectDir);
    expect(cfg.source).toBe("defaults");
    expect(cfg.wings).toEqual({});
  });

  it("loads memory.wings from context.yaml", () => {
    writeContextYaml(`
schema_version: "1.0"
name: myproject
type: project
memory:
  wings:
    decisions: wing_myproject_adrs
    findings: wing_myproject_issues
    default: wing_myproject
`);

    const cfg = loadWingConfig(projectDir);
    expect(cfg.source).toBe("context.yaml");
    expect(cfg.wings.decisions).toBe("wing_myproject_adrs");
    expect(cfg.wings.findings).toBe("wing_myproject_issues");
    expect(cfg.wings.default).toBe("wing_myproject");
  });

  it("falls back to defaults when context.yaml has no memory section", () => {
    writeContextYaml(`
schema_version: "1.0"
name: myproject
type: project
`);

    const cfg = loadWingConfig(projectDir);
    expect(cfg.source).toBe("defaults");
    expect(cfg.contextPath).toBeDefined();
  });

  it("ignores malformed YAML without throwing", () => {
    writeContextYaml("this is: not: valid: yaml: at all: [");
    const cfg = loadWingConfig(projectDir);
    expect(cfg.source).toBe("defaults");
  });

  it("walks up to 6 parent directories to find context.yaml", () => {
    const subdir = join(projectDir, "a", "b", "c");
    mkdirSync(subdir, { recursive: true });
    writeContextYaml(`
schema_version: "1.0"
memory:
  wings:
    decisions: wing_walked
`);

    const cfg = loadWingConfig(subdir);
    expect(cfg.source).toBe("context.yaml");
    expect(cfg.wings.decisions).toBe("wing_walked");
  });

  // ─── resolveWing precedence ──────────────────────────

  it("explicit wing_* name wins over everything", () => {
    const cfg = { wings: { decisions: "wing_override" }, source: "defaults" as const };
    expect(resolveWing("wing_explicit", cfg)).toBe("wing_explicit");
  });

  it("context.yaml override takes precedence over built-in defaults", () => {
    const cfg = {
      wings: { decisions: "wing_custom_decisions" },
      source: "context.yaml" as const,
    };
    expect(resolveWing("decisions", cfg)).toBe("wing_custom_decisions");
  });

  it("falls back to built-in DEFAULT_WINGS when no override", () => {
    const cfg = { wings: {}, source: "defaults" as const };
    expect(resolveWing("decisions", cfg)).toBe(DEFAULT_WINGS.decisions);
    expect(resolveWing("facts", cfg)).toBe(DEFAULT_WINGS.facts);
    expect(resolveWing("findings", cfg)).toBe(DEFAULT_WINGS.findings);
  });

  it("unknown category falls through to default", () => {
    const cfg = { wings: {}, source: "defaults" as const };
    expect(resolveWing("totally_unknown", cfg)).toBe(DEFAULT_WINGS.default);
  });

  it("empty category goes straight to default", () => {
    const cfg = { wings: {}, source: "defaults" as const };
    expect(resolveWing("", cfg)).toBe(DEFAULT_WINGS.default);
  });

  it("category lookup is case-insensitive", () => {
    const cfg = { wings: {}, source: "defaults" as const };
    expect(resolveWing("DECISIONS", cfg)).toBe(DEFAULT_WINGS.decisions);
    expect(resolveWing("Decisions", cfg)).toBe(DEFAULT_WINGS.decisions);
  });

  // ─── resolveItemWing ─────────────────────────────────

  it("explicit item.wing wins over item.category", () => {
    const cfg = { wings: {}, source: "defaults" as const };
    expect(resolveItemWing({ wing: "wing_explicit", category: "decisions" }, cfg)).toBe(
      "wing_explicit",
    );
  });

  it("falls back to category when no explicit wing", () => {
    const cfg = { wings: {}, source: "defaults" as const };
    expect(resolveItemWing({ category: "findings" }, cfg)).toBe(DEFAULT_WINGS.findings);
  });

  it("returns default when neither wing nor category given", () => {
    const cfg = { wings: {}, source: "defaults" as const };
    expect(resolveItemWing({}, cfg)).toBe(DEFAULT_WINGS.default);
  });
});
