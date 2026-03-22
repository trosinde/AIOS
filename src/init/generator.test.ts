import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { generate } from "./generator.js";
import { createDefaultContext, serializeContext } from "./schema.js";
import type { ContextConfig } from "../types.js";

function makeContext(overrides: Partial<ContextConfig> = {}): ContextConfig {
  const base = createDefaultContext({
    project: { name: "test-project", description: "Test", domain: "web-backend", language: "typescript", repo: "https://github.com/test/repo" },
    aios: { path: "/home/user/AIOS", readOnly: true },
  });
  return { ...base, ...overrides };
}

describe("generator", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aios-gen-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("generate", () => {
    it("creates .aios/ directory structure", () => {
      const ctx = makeContext();
      const result = generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      expect(existsSync(join(testDir, ".aios"))).toBe(true);
      expect(existsSync(join(testDir, ".aios", "context.yaml"))).toBe(true);
      expect(existsSync(join(testDir, ".aios", "agent-instructions.md"))).toBe(true);
      expect(existsSync(join(testDir, ".aios", "patterns", ".gitkeep"))).toBe(true);
      expect(existsSync(join(testDir, ".aios", "knowledge", "decisions", ".gitkeep"))).toBe(true);
      expect(existsSync(join(testDir, ".aios", "knowledge", "requirements", ".gitkeep"))).toBe(true);
      expect(existsSync(join(testDir, ".aios", "knowledge", "facts", ".gitkeep"))).toBe(true);
      expect(existsSync(join(testDir, ".aios", ".gitignore"))).toBe(true);
      expect(result.created.length).toBeGreaterThan(0);
    });

    it("generates valid unified context.yaml", () => {
      const ctx = makeContext();
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      const content = readFileSync(join(testDir, ".aios", "context.yaml"), "utf-8");
      expect(content).toContain("test-project");
      expect(content).toContain("schema_version");
      expect(content).toContain("type: project");
      expect(content).toContain("web-backend");
      expect(content).toContain("typescript");
    });

    it("generates agent-instructions.md with project info", () => {
      const ctx = makeContext();
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      const content = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
      expect(content).toContain("AIOS Agent Instructions");
      expect(content).toContain("test-project");
      expect(content).toContain("web-backend");
      expect(content).toContain("/home/user/AIOS");
    });

    it("includes read-only constraint when enabled", () => {
      const ctx = makeContext();
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      const content = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
      expect(content).toContain("READ-ONLY CONSTRAINT");
      expect(content).toContain("NEVER modify");
    });

    it("omits read-only section when disabled", () => {
      const ctx = makeContext({ aios: { path: "/home/user/AIOS", readOnly: false } });
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      const content = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
      expect(content).not.toContain("READ-ONLY CONSTRAINT");
    });

    it("includes compliance standards", () => {
      const ctx = makeContext({
        compliance: {
          standards: [{ id: "owasp" }, { id: "iec-62443", level: "SL2" }],
          requireTraceability: true,
          requireTestCoverage: true,
          minimumCoverage: 80,
        },
      });
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      const content = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
      expect(content).toContain("owasp");
      expect(content).toContain("iec-62443 (SL2)");
    });

    it("includes personas", () => {
      const ctx = makeContext({
        personas: { active: ["developer", "architect"], inactive: ["tester"] },
      });
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      const content = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
      expect(content).toContain("- developer");
      expect(content).toContain("- architect");
    });

    it("includes provider routing", () => {
      const ctx = makeContext({
        providers: { routing: { complex: "anthropic", quick: "ollama" } },
      });
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      const content = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
      expect(content).toContain("complex: anthropic");
      expect(content).toContain("quick: ollama");
    });

    it("generates .gitignore for knowledge/", () => {
      const ctx = makeContext();
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      const gitignore = readFileSync(join(testDir, ".aios", ".gitignore"), "utf-8");
      expect(gitignore).toContain("knowledge/");
    });
  });

  describe("CLAUDE.md handling", () => {
    it("creates CLAUDE.md if not exists", () => {
      const ctx = makeContext();
      generate(ctx, { cwd: testDir, patchClaudeMd: true });

      expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(true);
      const content = readFileSync(join(testDir, "CLAUDE.md"), "utf-8");
      expect(content).toContain("AIOS");
      expect(content).toContain(".aios/agent-instructions.md");
    });

    it("appends AIOS pointer to existing CLAUDE.md", () => {
      writeFileSync(join(testDir, "CLAUDE.md"), "# My Project\n\nSome instructions.\n");
      const ctx = makeContext();
      generate(ctx, { cwd: testDir, patchClaudeMd: true });

      const content = readFileSync(join(testDir, "CLAUDE.md"), "utf-8");
      expect(content).toContain("# My Project");
      expect(content).toContain("## AIOS");
      expect(content).toContain(".aios/agent-instructions.md");
    });

    it("does not modify CLAUDE.md if already has AIOS pointer", () => {
      const original = "# Project\n\n## AIOS\nRead .aios/agent-instructions.md\n";
      writeFileSync(join(testDir, "CLAUDE.md"), original);
      const ctx = makeContext();
      const result = generate(ctx, { cwd: testDir, patchClaudeMd: true });

      const content = readFileSync(join(testDir, "CLAUDE.md"), "utf-8");
      expect(content).toBe(original);
      expect(result.modified).not.toContain(join(testDir, "CLAUDE.md"));
    });

    it("skips CLAUDE.md when skipClaudeMdPrompt is true and no CLAUDE.md exists", () => {
      const ctx = makeContext();
      const result = generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(false);
      expect(result.skipped).toContain(join(testDir, "CLAUDE.md"));
    });
  });

  describe("never overwrites pattern overrides", () => {
    it("keeps existing patterns/ content", () => {
      mkdirSync(join(testDir, ".aios", "patterns", "my-pattern"), { recursive: true });
      writeFileSync(join(testDir, ".aios", "patterns", "my-pattern", "system.md"), "my custom pattern");

      const ctx = makeContext();
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      const content = readFileSync(join(testDir, ".aios", "patterns", "my-pattern", "system.md"), "utf-8");
      expect(content).toBe("my custom pattern");
    });
  });

  describe("refresh mode", () => {
    it("regenerates agent-instructions.md from existing context.yaml", () => {
      // First: generate normally
      const ctx = makeContext();
      generate(ctx, { cwd: testDir, skipClaudeMdPrompt: true });

      // Modify context.yaml — write unified format
      const newCtx = makeContext({
        name: "updated-project",
        description: "Updated",
        project: { domain: "systems", language: "rust", repo: null },
      });
      writeFileSync(
        join(testDir, ".aios", "context.yaml"),
        "# AIOS\n\n" + serializeContext(newCtx),
      );

      // Refresh
      const result = generate({} as never, { refresh: true, cwd: testDir });

      const content = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
      expect(content).toContain("updated-project");
      expect(content).toContain("systems");
      expect(result.modified).toContain(join(testDir, ".aios", "agent-instructions.md"));
    });

    it("throws if no context.yaml exists", () => {
      expect(() => generate({} as never, { refresh: true, cwd: testDir })).toThrow("No .aios/context.yaml found");
    });
  });
});
