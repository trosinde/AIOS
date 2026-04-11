import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { readVersion, syncNewFiles, migrateFromLegacyKb } from "./update.js";

describe("readVersion", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aios-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns version from valid package.json", () => {
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    expect(readVersion(testDir)).toBe("1.2.3");
  });

  it("returns 'unknown' when package.json is missing", () => {
    expect(readVersion(testDir)).toBe("unknown");
  });

  it("returns 'unknown' when version field is missing", () => {
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test" }));
    expect(readVersion(testDir)).toBe("unknown");
  });

  it("returns 'unknown' when package.json is corrupt", () => {
    writeFileSync(join(testDir, "package.json"), "not json{{{");
    expect(readVersion(testDir)).toBe("unknown");
  });
});

describe("syncNewFiles", () => {
  let sourceDir: string;
  let targetDir: string;

  beforeEach(() => {
    const base = join(tmpdir(), `aios-test-${randomUUID()}`);
    sourceDir = join(base, "source");
    targetDir = join(base, "target");
    mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    const base = join(sourceDir, "..");
    rmSync(base, { recursive: true, force: true });
  });

  it("copies new files to target", () => {
    writeFileSync(join(sourceDir, "a.txt"), "hello");
    syncNewFiles(sourceDir, targetDir);
    expect(readFileSync(join(targetDir, "a.txt"), "utf-8")).toBe("hello");
  });

  it("does not overwrite existing files in target", () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "a.txt"), "original");
    writeFileSync(join(sourceDir, "a.txt"), "updated");
    syncNewFiles(sourceDir, targetDir);
    expect(readFileSync(join(targetDir, "a.txt"), "utf-8")).toBe("original");
  });

  it("handles missing source directory without error", () => {
    const nonExistent = join(sourceDir, "..", "nope");
    expect(() => syncNewFiles(nonExistent, targetDir)).not.toThrow();
    expect(existsSync(targetDir)).toBe(false);
  });

  it("creates target directory if it does not exist", () => {
    writeFileSync(join(sourceDir, "b.txt"), "data");
    syncNewFiles(sourceDir, targetDir);
    expect(existsSync(targetDir)).toBe(true);
    expect(readFileSync(join(targetDir, "b.txt"), "utf-8")).toBe("data");
  });
});

describe("migrateFromLegacyKb", () => {
  let aiosHome: string;
  let repoPath: string;

  beforeEach(() => {
    aiosHome = join(tmpdir(), `aios-mig-home-${randomUUID()}`);
    repoPath = join(tmpdir(), `aios-mig-repo-${randomUUID()}`);
    mkdirSync(aiosHome, { recursive: true });
    mkdirSync(repoPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(aiosHome, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  function makeKbPattern(name: string, content: string, root: string) {
    const dir = join(root, "patterns", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "system.md"), content);
  }

  it("is a no-op on a clean installation", () => {
    const result = migrateFromLegacyKb(aiosHome, repoPath);
    expect(result.changes).toEqual([]);
    expect(result.backupPath).toBeUndefined();
  });

  it("backs up legacy bus.db file inside knowledge directory", () => {
    const knowledgeDir = join(aiosHome, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(join(knowledgeDir, "bus.db"), "fake sqlite content");

    const result = migrateFromLegacyKb(aiosHome, repoPath);
    expect(result.changes.length).toBeGreaterThan(0);
    expect(existsSync(join(knowledgeDir, "bus.db"))).toBe(false);
    expect(existsSync(join(knowledgeDir, "bus.db.pre-lance.bak"))).toBe(true);
  });

  it("removes stale memory_recall_fetch / memory_store_persist patterns", () => {
    const fetchDir = join(aiosHome, "patterns", "memory_recall_fetch");
    const persistDir = join(aiosHome, "patterns", "memory_store_persist");
    mkdirSync(fetchDir, { recursive: true });
    mkdirSync(persistDir, { recursive: true });
    writeFileSync(join(fetchDir, "system.md"), "stale");
    writeFileSync(join(persistDir, "system.md"), "stale");

    const result = migrateFromLegacyKb(aiosHome, repoPath);
    expect(result.changes).toContain("removed stale pattern memory_recall_fetch");
    expect(result.changes).toContain("removed stale pattern memory_store_persist");
    expect(existsSync(fetchDir)).toBe(false);
    expect(existsSync(persistDir)).toBe(false);
  });

  it("force-overwrites legacy memory_recall pattern when local lacks type: kb", () => {
    makeKbPattern(
      "memory_recall",
      "---\nname: memory_recall\ntype: llm\n---\nlegacy body",
      aiosHome,
    );
    makeKbPattern(
      "memory_recall",
      "---\nname: memory_recall\ntype: kb\nkb_operation: recall\n---\nnew body",
      repoPath,
    );

    const result = migrateFromLegacyKb(aiosHome, repoPath);
    expect(result.changes).toContain("upgraded pattern memory_recall to type: kb");

    const upgraded = readFileSync(join(aiosHome, "patterns", "memory_recall", "system.md"), "utf-8");
    expect(upgraded).toContain("type: kb");
    expect(upgraded).toContain("new body");
  });

  it("does not touch a memory_recall pattern that is already type: kb", () => {
    const customBody = "---\nname: memory_recall\ntype: kb\n---\nUSER CUSTOMIZED BODY";
    makeKbPattern("memory_recall", customBody, aiosHome);
    makeKbPattern(
      "memory_recall",
      "---\nname: memory_recall\ntype: kb\n---\nrepo body",
      repoPath,
    );

    const result = migrateFromLegacyKb(aiosHome, repoPath);
    expect(result.changes.find((c) => c.includes("memory_recall"))).toBeUndefined();

    const local = readFileSync(join(aiosHome, "patterns", "memory_recall", "system.md"), "utf-8");
    expect(local).toBe(customBody);
  });

  it("upgrades memory_store the same way", () => {
    makeKbPattern(
      "memory_store",
      "---\nname: memory_store\ntype: llm\n---\nlegacy",
      aiosHome,
    );
    makeKbPattern(
      "memory_store",
      "---\nname: memory_store\ntype: kb\nkb_operation: store\n---\nnew",
      repoPath,
    );

    const result = migrateFromLegacyKb(aiosHome, repoPath);
    expect(result.changes).toContain("upgraded pattern memory_store to type: kb");
  });

  it("handles missing repo files gracefully", () => {
    makeKbPattern(
      "memory_recall",
      "---\nname: memory_recall\ntype: llm\n---\nlocal only",
      aiosHome,
    );
    // No repo copy of the pattern
    const result = migrateFromLegacyKb(aiosHome, repoPath);
    expect(result.changes.find((c) => c.includes("memory_recall"))).toBeUndefined();
  });
});
