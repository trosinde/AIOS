import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { readVersion, syncNewFiles } from "./update.js";

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
