import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

/**
 * The order of these candidates is load-bearing, not cosmetic.
 *
 * `install.sh` clones into ~/.aios/repo, and `aios update` runs `git pull`
 * there. `aios init --template` links the skill into whatever this function
 * returns — so if ~/.aios/repo stops winning, an installed user gets a
 * forensics workspace with a warning instead of the skill, and `aios init`
 * writes a context without an aios.path. Hence: pin the list.
 *
 * homedir() is mocked rather than driven through $HOME, because os.homedir()
 * honours $HOME on POSIX but not on Windows, and this feature is explicitly
 * cross-platform.
 */

let fakeHome: string;
let tmp: string;

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => fakeHome };
});

/** A directory that looks like an AIOS checkout: both patterns/ and src/. */
function makeInstall(dir: string): string {
  mkdirSync(join(dir, "patterns"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

describe("detectAiosPath", () => {
  beforeEach(() => {
    tmp = join(tmpdir(), `aios-path-${randomUUID()}`);
    fakeHome = join(tmp, "home");
    mkdirSync(fakeHome, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.resetModules();
  });

  it("prefers ~/.aios/repo over a sibling checkout", async () => {
    const { detectAiosPath } = await import("./aios-path.js");
    const installed = makeInstall(join(fakeHome, ".aios", "repo"));
    const project = join(tmp, "work", "my-project");
    mkdirSync(project, { recursive: true });
    makeInstall(join(tmp, "work", "AIOS"));

    expect(detectAiosPath(project)).toBe(installed);
  });

  it("falls back to a sibling checkout when ~/.aios/repo is absent", async () => {
    const { detectAiosPath } = await import("./aios-path.js");
    const project = join(tmp, "work", "my-project");
    mkdirSync(project, { recursive: true });
    const sibling = makeInstall(join(tmp, "work", "AIOS"));

    expect(detectAiosPath(project)).toBe(sibling);
  });

  it("requires both patterns/ and src/ — patterns/ alone is not an install", async () => {
    const { detectAiosPath } = await import("./aios-path.js");
    mkdirSync(join(fakeHome, ".aios", "repo", "patterns"), { recursive: true });
    const project = join(tmp, "work", "my-project");
    mkdirSync(project, { recursive: true });

    expect(detectAiosPath(project)).toBeNull();
  });

  it("ignores a candidate that is a file rather than a directory", async () => {
    const { detectAiosPath } = await import("./aios-path.js");
    mkdirSync(join(fakeHome, ".aios"), { recursive: true });
    writeFileSync(join(fakeHome, ".aios", "repo"), "not a directory");
    const project = join(tmp, "work", "my-project");
    mkdirSync(project, { recursive: true });

    expect(detectAiosPath(project)).toBeNull();
  });

  it("returns null when no candidate looks like an install", async () => {
    const { detectAiosPath } = await import("./aios-path.js");
    const project = join(tmp, "work", "my-project");
    mkdirSync(project, { recursive: true });

    expect(detectAiosPath(project)).toBeNull();
  });
});

describe("aiosPathCandidates", () => {
  beforeEach(() => {
    tmp = join(tmpdir(), `aios-path-cand-${randomUUID()}`);
    fakeHome = join(tmp, "home");
    mkdirSync(fakeHome, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.resetModules();
  });

  it("lists the six locations, starting with ~/.aios/repo", async () => {
    const { aiosPathCandidates } = await import("./aios-path.js");
    const cwd = join(tmp, "work", "my-project");

    expect(aiosPathCandidates(cwd)).toEqual([
      join(fakeHome, ".aios", "repo"),
      join(tmp, "work", "AIOS"),
      join(tmp, "work", "aios"),
      join(fakeHome, "tools", "AIOS"),
      join(fakeHome, "AIOS"),
      join(fakeHome, ".local", "share", "aios"),
    ]);
  });

  it("returns absolute paths only", async () => {
    const { aiosPathCandidates } = await import("./aios-path.js");
    for (const c of aiosPathCandidates(join(tmp, "work", "p"))) {
      expect(c.startsWith("/") || /^[A-Za-z]:/.test(c)).toBe(true);
    }
  });
});
