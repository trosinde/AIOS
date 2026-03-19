import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { scanProject } from "./scanner.js";
import { createDefaultContext, parseContextYaml, serializeContext } from "./schema.js";
import { generate } from "./generator.js";

describe("aios init integration", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aios-init-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("full flow: scan → context → generate on TypeScript project", () => {
    // Setup a fixture TS project
    writeFileSync(join(testDir, "package.json"), JSON.stringify({
      name: "integration-test",
      description: "Integration test project",
      type: "module",
      devDependencies: { typescript: "^5.0.0", vitest: "^2.0.0" },
      dependencies: { express: "^4.0.0" },
    }));
    writeFileSync(join(testDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext" },
    }));
    mkdirSync(join(testDir, "src"), { recursive: true });
    writeFileSync(join(testDir, "src", "index.ts"), "export const x = 1;");
    mkdirSync(join(testDir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(testDir, ".github", "workflows", "ci.yml"), "name: CI");

    // 1. Scan
    const scan = scanProject(testDir);
    expect(scan.projectName).toBe("integration-test");
    expect(scan.language).toBe("typescript");
    expect(scan.hasTests).toBe(true);
    expect(scan.hasCi).toBe(true);

    // 2. Build context (simulates quick mode)
    const context = createDefaultContext({
      project: {
        name: scan.projectName!,
        description: scan.description ?? "",
        domain: "web-backend",
        language: scan.language,
        repo: scan.gitRemote,
      },
      aios: { path: "/home/user/AIOS", readOnly: true },
      compliance: { standards: [], requireTraceability: false, requireTestCoverage: true },
      personas: { active: ["developer", "reviewer"], inactive: [] },
      providers: { routing: {} },
      knowledge: { autoIndex: ["docs/**/*.md"], autoExtract: false },
    });

    // 3. Generate
    const result = generate(context, { cwd: testDir, patchClaudeMd: true });

    // 4. Assert structure
    expect(existsSync(join(testDir, ".aios", "context.yaml"))).toBe(true);
    expect(existsSync(join(testDir, ".aios", "agent-instructions.md"))).toBe(true);
    expect(existsSync(join(testDir, ".aios", "patterns", ".gitkeep"))).toBe(true);
    expect(existsSync(join(testDir, ".aios", ".gitignore"))).toBe(true);

    // 5. Validate context.yaml
    const contextContent = readFileSync(join(testDir, ".aios", "context.yaml"), "utf-8");
    const parsed = parseContextYaml(contextContent);
    expect(parsed.project.name).toBe("integration-test");
    expect(parsed.project.language).toBe("typescript");
    expect(parsed.aios.readOnly).toBe(true);

    // 6. Check agent-instructions.md
    const instructions = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
    expect(instructions).toContain("integration-test");
    expect(instructions).toContain("READ-ONLY CONSTRAINT");
    expect(instructions).toContain("Pattern Resolution Order");

    // 7. CLAUDE.md was created
    expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(true);
    const claudeMd = readFileSync(join(testDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain(".aios/agent-instructions.md");
  });

  it("refresh only regenerates agent-instructions.md", () => {
    // Setup: create .aios with context
    const context = createDefaultContext({
      project: { name: "refresh-test", description: "", domain: "general", language: "unknown", repo: null },
      aios: { path: "/aios", readOnly: true },
    });
    generate(context, { cwd: testDir, skipClaudeMdPrompt: true });

    // Read original instructions
    const original = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
    expect(original).toContain("refresh-test");

    // Modify context.yaml
    const newCtx = createDefaultContext({
      project: { name: "refreshed-name", description: "updated", domain: "systems", language: "rust", repo: null },
      aios: { path: "/aios", readOnly: false },
    });
    writeFileSync(
      join(testDir, ".aios", "context.yaml"),
      "# AIOS\n\n" + serializeContext(newCtx),
    );

    // Refresh
    const refreshResult = generate({} as never, { refresh: true, cwd: testDir });

    // Only agent-instructions.md should change
    expect(refreshResult.modified).toContain(join(testDir, ".aios", "agent-instructions.md"));
    expect(refreshResult.created).toEqual([]);

    const refreshed = readFileSync(join(testDir, ".aios", "agent-instructions.md"), "utf-8");
    expect(refreshed).toContain("refreshed-name");
    expect(refreshed).toContain("systems");
    expect(refreshed).not.toContain("READ-ONLY CONSTRAINT"); // readOnly was set to false
  });

  it("does not modify existing CLAUDE.md that already has AIOS pointer", () => {
    const original = "# MyProject\n\n## AIOS\nRead .aios/agent-instructions.md\n";
    writeFileSync(join(testDir, "CLAUDE.md"), original);

    const context = createDefaultContext({
      project: { name: "test", description: "", domain: "general", language: "unknown", repo: null },
      aios: { path: "/aios", readOnly: true },
    });
    generate(context, { cwd: testDir, patchClaudeMd: true });

    const content = readFileSync(join(testDir, "CLAUDE.md"), "utf-8");
    expect(content).toBe(original);
  });

  it("works on empty directory with quick defaults", () => {
    const scan = scanProject(testDir);
    const context = createDefaultContext({
      project: {
        name: scan.projectName ?? "empty-project",
        description: "",
        domain: "general",
        language: scan.language,
        repo: null,
      },
      aios: { path: "/aios", readOnly: true },
    });

    const result = generate(context, { cwd: testDir, skipClaudeMdPrompt: true });
    expect(result.created.length).toBeGreaterThan(0);
    expect(existsSync(join(testDir, ".aios", "context.yaml"))).toBe(true);
    expect(existsSync(join(testDir, ".aios", "agent-instructions.md"))).toBe(true);
  });
});
