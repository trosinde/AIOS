import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { buildContextAwareRegistry } from "./registry-factory.js";

const tmpBase = join(process.cwd(), "tmp-test-factory");

function writePattern(dir: string, name: string, description: string): void {
  const patternDir = join(dir, name);
  mkdirSync(patternDir, { recursive: true });
  writeFileSync(join(patternDir, "system.md"), [
    "---",
    "kernel_abi: 1",
    `name: ${name}`,
    `description: "${description}"`,
    "category: test",
    "input_type: text",
    "output_type: text",
    "tags: []",
    "---",
    "",
    `Prompt for ${name}`,
  ].join("\n"));
}

describe("buildContextAwareRegistry", () => {
  const repoPatterns = join(tmpBase, "repo-patterns");

  beforeEach(() => {
    mkdirSync(repoPatterns, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("lädt Patterns aus dem übergebenen Verzeichnis", () => {
    writePattern(repoPatterns, "test_pattern", "from-repo");
    const registry = buildContextAwareRegistry(repoPatterns);
    expect(registry.get("test_pattern")).toBeDefined();
    expect(registry.get("test_pattern")!.meta.description).toBe("from-repo");
  });

  it("gibt leere Registry bei nicht-existierendem Verzeichnis", () => {
    const registry = buildContextAwareRegistry("/tmp/nonexistent_factory_xyz_12345");
    // Should not crash, may have kernel patterns if they exist
    expect(registry).toBeDefined();
    expect(Array.isArray(registry.list())).toBe(true);
  });

  it("patternsDirs enthält übergebenes Verzeichnis", () => {
    writePattern(repoPatterns, "test_pattern", "from-repo");
    const registry = buildContextAwareRegistry(repoPatterns);
    expect(registry.patternsDirs).toContain(repoPatterns);
  });
});
