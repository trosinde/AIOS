import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

/**
 * Windows without Developer Mode or elevation cannot create symlinks, and
 * Windows is the primary platform of a skill that ships collect.ps1,
 * detect.ps1 and fetch-tools.ps1. In that case applyTemplate copies the
 * directory instead — and must say that `aios update` will no longer reach
 * the copy, because it still exits successfully.
 *
 * The mock lives in its own file: vi.mock is module-scoped, and making
 * symlinkSync throw would break every other test in template.test.ts.
 */
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    symlinkSync: vi.fn(() => {
      const err = new Error("EPERM: operation not permitted, symlink") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    }),
  };
});

let tmp: string;
let templatesRoot: string;
let workspace: string;
let fakeAios: string;

function writeFixture(name: string, manifestExtra = ""): void {
  const dir = join(templatesRoot, name);
  mkdirSync(join(dir, "dot-aios"), { recursive: true });
  writeFileSync(join(dir, "template.yaml"),
    `name: ${name}\ndescription: Fixture for the Windows fallback\n${manifestExtra}`);
  writeFileSync(join(dir, "dot-aios", "context.yaml"),
    'schema_version: "1.0"\nname: "{{name}}"\ntype: project\n');
}

describe("applyTemplate — symlink unavailable (Windows without privileges)", () => {
  beforeEach(() => {
    tmp = join(tmpdir(), `aios-tpl-win-${randomUUID()}`);
    templatesRoot = join(tmp, "templates");
    workspace = join(tmp, "workspace");
    fakeAios = join(tmp, "aios-install");
    mkdirSync(templatesRoot, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    const skill = join(fakeAios, ".claude", "skills", "host-forensics");
    mkdirSync(join(skill, "scripts"), { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "---\nname: host-forensics\n---\n");
    writeFileSync(join(skill, "scripts", "collect.ps1"), "# collect\n");
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.resetModules();
  });

  it("copies the skill directory and warns that updates will not propagate", async () => {
    const { applyTemplate } = await import("./template.js");
    writeFixture("alpha",
      "links:\n  - path: .claude/skills/host-forensics\n    target: .claude/skills/host-forensics\n");

    const result = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });

    const linkPath = join(workspace, ".claude", "skills", "host-forensics");
    // A real directory, not a link — and the contents actually arrived,
    // including the nested scripts/ folder (recursive copy).
    expect(statSync(linkPath).isDirectory()).toBe(true);
    expect(statSync(linkPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(linkPath, "SKILL.md"), "utf-8")).toContain("host-forensics");
    expect(existsSync(join(linkPath, "scripts", "collect.ps1"))).toBe(true);

    expect(result.links).toEqual([]);
    expect(result.created).toContain(linkPath);

    const warnings = result.warnings.join(" ");
    expect(warnings).toMatch(/Copied it instead/);
    expect(warnings).toMatch(/aios update/i);
    expect(warnings).toMatch(/EPERM/);
  });

  it("warns and keeps going when neither a symlink nor a copy works", async () => {
    vi.doMock("fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("fs")>();
      return {
        ...actual,
        symlinkSync: vi.fn(() => { throw new Error("EPERM: operation not permitted, symlink"); }),
        cpSync: vi.fn(() => { throw new Error("ENOSPC: no space left on device"); }),
      };
    });
    vi.resetModules();

    const { applyTemplate } = await import("./template.js");
    writeFixture("beta",
      "links:\n  - path: .claude/skills/host-forensics\n    target: .claude/skills/host-forensics\n");

    // It must not throw: the rest of the workspace is still worth having.
    const result = applyTemplate({ name: "beta", cwd: workspace, templatesRoot, aiosRoot: fakeAios });

    expect(result.links).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/Neither a symlink nor a copy worked/);
    expect(existsSync(join(workspace, ".aios", "context.yaml"))).toBe(true);
  });
});
