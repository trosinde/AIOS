import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, lstatSync,
  readlinkSync, symlinkSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
  applyTemplate, listTemplates, describeTemplate, defaultTemplatesRoot, relativize,
} from "./template.js";
import { parseContextYaml } from "./schema.js";

/**
 * Tests for the generic workspace-template mechanism.
 *
 * Most tests build a throwaway template on disk, so they verify the
 * mechanism rather than the shipped forensics content. The last block
 * checks the real `forensics` template, because that one is what users get.
 */

describe("workspace templates", () => {
  let tmp: string;
  let templatesRoot: string;
  let workspace: string;
  let fakeAios: string;

  /** A minimal but complete template: manifest + context.yaml + one file. */
  function writeFixtureTemplate(name: string, extra: Record<string, string> = {}, manifestExtra = ""): string {
    const dir = join(templatesRoot, name);
    mkdirSync(join(dir, "dot-aios"), { recursive: true });
    writeFileSync(join(dir, "template.yaml"),
      `name: ${name}\ndescription: Fixture template for tests\n${manifestExtra}`);
    writeFileSync(join(dir, "dot-aios", "context.yaml"),
      [
        'schema_version: "1.0"',
        'name: "{{name}}"',
        "description: fixture",
        "type: project",
        "config:",
        "  default_provider: ollama",
        "  patterns_dir: ./patterns",
        "  personas_dir: ./personas",
        "  knowledge_dir: ./knowledge",
        "personas:",
        "  active:",
        "    - forensic_analyst",
        "  inactive: []",
        "",
      ].join("\n"));
    writeFileSync(join(dir, "README.md"), "# Fixture\n");
    writeFileSync(join(dir, "dot-gitignore"), "cases/\ntools/\n");
    for (const [rel, content] of Object.entries(extra)) {
      const target = join(dir, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content);
    }
    return dir;
  }

  beforeEach(() => {
    tmp = join(tmpdir(), `aios-tpl-${randomUUID()}`);
    templatesRoot = join(tmp, "templates");
    workspace = join(tmp, "my-workspace");
    fakeAios = join(tmp, "aios-install");
    mkdirSync(templatesRoot, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    // A stand-in AIOS install with a linkable skill directory
    mkdirSync(join(fakeAios, ".claude", "skills", "host-forensics"), { recursive: true });
    writeFileSync(join(fakeAios, ".claude", "skills", "host-forensics", "SKILL.md"), "---\nname: x\n---\n");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // ─── Discovery ─────────────────────────────────────────

  it("lists templates with name and description", () => {
    writeFixtureTemplate("alpha");
    writeFixtureTemplate("beta");
    const found = listTemplates(templatesRoot);
    expect(found.map(t => t.name)).toEqual(["alpha", "beta"]);
    expect(found[0]?.description).toBe("Fixture template for tests");
  });

  it("returns an empty list when the templates directory is missing", () => {
    expect(listTemplates(join(tmp, "does-not-exist"))).toEqual([]);
  });

  it("ignores a template whose manifest is broken", () => {
    writeFixtureTemplate("good");
    const broken = join(templatesRoot, "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "template.yaml"), "description: no name here\n");
    expect(listTemplates(templatesRoot).map(t => t.name)).toEqual(["good"]);
  });

  it("ignores a directory without a manifest", () => {
    writeFixtureTemplate("good");
    mkdirSync(join(templatesRoot, "no-manifest"), { recursive: true });
    expect(listTemplates(templatesRoot).map(t => t.name)).toEqual(["good"]);
  });

  it("describeTemplate reads dirs, links and next_steps", () => {
    writeFixtureTemplate("full", {}, [
      "dirs:",
      "  - cases",
      "  - tools",
      "links:",
      "  - path: .claude/skills/host-forensics",
      "    target: .claude/skills/host-forensics",
      "next_steps:",
      "  - do the thing",
      "",
    ].join("\n"));
    const m = describeTemplate("full", templatesRoot);
    expect(m.dirs).toEqual(["cases", "tools"]);
    expect(m.links).toEqual([{ path: ".claude/skills/host-forensics", target: ".claude/skills/host-forensics" }]);
    expect(m.next_steps).toEqual(["do the thing"]);
  });

  // ─── Apply: happy path ─────────────────────────────────

  it("creates the .aios tree, copies files and maps the dot- prefix", () => {
    writeFixtureTemplate("alpha");
    const result = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });

    expect(existsSync(join(workspace, ".aios", "context.yaml"))).toBe(true);
    expect(existsSync(join(workspace, ".aios", "agent-instructions.md"))).toBe(true);
    expect(existsSync(join(workspace, "README.md"))).toBe(true);
    // dot-gitignore -> .gitignore, so the template's ignore rules do not
    // apply inside the AIOS repository itself
    expect(existsSync(join(workspace, ".gitignore"))).toBe(true);
    expect(existsSync(join(workspace, "dot-gitignore"))).toBe(false);
    expect(readFileSync(join(workspace, ".gitignore"), "utf-8")).toContain("cases/");
    // the manifest is configuration, not workspace content
    expect(existsSync(join(workspace, "template.yaml"))).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("substitutes {{name}} with the workspace directory name", () => {
    writeFixtureTemplate("alpha");
    applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    const ctx = parseContextYaml(readFileSync(join(workspace, ".aios", "context.yaml"), "utf-8"));
    expect(ctx.name).toBe("my-workspace");
  });

  it("honours an explicit workspaceName", () => {
    writeFixtureTemplate("alpha");
    applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios, workspaceName: "fall-42" });
    const ctx = parseContextYaml(readFileSync(join(workspace, ".aios", "context.yaml"), "utf-8"));
    expect(ctx.name).toBe("fall-42");
  });

  it("records the AIOS path in the generated context", () => {
    writeFixtureTemplate("alpha");
    const result = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    expect(result.context.aios?.path).toBe(fakeAios);
    const ctx = parseContextYaml(readFileSync(join(workspace, ".aios", "context.yaml"), "utf-8"));
    expect(ctx.aios?.path).toBe(fakeAios);
  });

  it("creates the declared empty directories", () => {
    writeFixtureTemplate("alpha", {}, "dirs:\n  - cases\n  - tools\n");
    applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    expect(existsSync(join(workspace, "cases"))).toBe(true);
    expect(existsSync(join(workspace, "tools"))).toBe(true);
  });

  it("does not patch CLAUDE.md — the template owns it", () => {
    writeFixtureTemplate("alpha", { "CLAUDE.md": "# From the template\n" });
    applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    expect(readFileSync(join(workspace, "CLAUDE.md"), "utf-8")).toBe("# From the template\n");
  });

  // ─── Apply: symlinks ───────────────────────────────────

  it("links a skill directory into the AIOS install with an absolute target", () => {
    writeFixtureTemplate("alpha", {},
      "links:\n  - path: .claude/skills/host-forensics\n    target: .claude/skills/host-forensics\n");
    const result = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });

    const link = join(workspace, ".claude", "skills", "host-forensics");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(resolve(fakeAios, ".claude", "skills", "host-forensics"));
    expect(existsSync(join(link, "SKILL.md"))).toBe(true);
    expect(result.links).toHaveLength(1);
  });

  it("warns instead of failing when no AIOS install is known", () => {
    writeFixtureTemplate("alpha", {},
      "links:\n  - path: .claude/skills/host-forensics\n    target: .claude/skills/host-forensics\n");
    const result = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: null });
    expect(result.links).toEqual([]);
    expect(result.warnings.join(" ")).toContain("No AIOS installation found");
    expect(existsSync(join(workspace, ".aios", "context.yaml"))).toBe(true);
  });

  it("warns when the link target is missing from the AIOS install", () => {
    writeFixtureTemplate("alpha", {},
      "links:\n  - path: .claude/skills/nope\n    target: .claude/skills/nope\n");
    const result = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    expect(result.links).toEqual([]);
    expect(result.warnings.join(" ")).toContain("Link target does not exist");
  });

  it("leaves an existing correct symlink alone without warning", () => {
    writeFixtureTemplate("alpha", {},
      "links:\n  - path: .claude/skills/host-forensics\n    target: .claude/skills/host-forensics\n");
    const link = join(workspace, ".claude", "skills", "host-forensics");
    mkdirSync(join(workspace, ".claude", "skills"), { recursive: true });
    symlinkSync(resolve(fakeAios, ".claude", "skills", "host-forensics"), link, "dir");

    const result = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    expect(result.skipped).toContain(link);
    expect(result.warnings).toEqual([]);
  });

  it("warns and keeps an existing path that is not the expected link", () => {
    writeFixtureTemplate("alpha", {},
      "links:\n  - path: .claude/skills/host-forensics\n    target: .claude/skills/host-forensics\n");
    const link = join(workspace, ".claude", "skills", "host-forensics");
    mkdirSync(link, { recursive: true });
    writeFileSync(join(link, "mine.md"), "hand-written");

    const result = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    expect(readFileSync(join(link, "mine.md"), "utf-8")).toBe("hand-written");
    expect(result.warnings.join(" ")).toContain("already exists and was left alone");
  });

  // ─── Apply: idempotence ────────────────────────────────

  it("never overwrites an existing file; it reports it as skipped", () => {
    writeFixtureTemplate("alpha");
    writeFileSync(join(workspace, "README.md"), "mine, do not touch\n");
    const result = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    expect(readFileSync(join(workspace, "README.md"), "utf-8")).toBe("mine, do not touch\n");
    expect(result.skipped).toContain(join(workspace, "README.md"));
  });

  it("keeps user edits to .aios/context.yaml on a second apply", () => {
    // The workspace tells the user to edit context.yaml and run
    // `aios init --refresh`. A re-apply (after `aios update`, or simply
    // twice) must not throw those edits away — and must not claim it
    // "created" the file it just overwrote.
    writeFixtureTemplate("alpha");
    applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });

    const ctxPath = join(workspace, ".aios", "context.yaml");
    const edited = readFileSync(ctxPath, "utf-8") + "\n# a line the user added\n";
    writeFileSync(ctxPath, edited);

    const second = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });

    expect(readFileSync(ctxPath, "utf-8")).toBe(edited);
    expect(second.skipped).toContain(ctxPath);
    expect(second.created).not.toContain(ctxPath);
  });

  it("can be applied twice without error", () => {
    writeFixtureTemplate("alpha", {}, "dirs:\n  - cases\n");
    applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    const second = applyTemplate({ name: "alpha", cwd: workspace, templatesRoot, aiosRoot: fakeAios });
    expect(second.skipped.length).toBeGreaterThan(0);
    expect(existsSync(join(workspace, "README.md"))).toBe(true);
  });

  // ─── Error paths ───────────────────────────────────────

  it("rejects an unknown template and names the available ones", () => {
    writeFixtureTemplate("alpha");
    expect(() => applyTemplate({ name: "nope", cwd: workspace, templatesRoot }))
      .toThrow(/Unknown template "nope".*alpha/s);
  });

  it.each([
    ["..", "parent directory"],
    ["../escape", "traversal"],
    ["Alpha", "uppercase"],
    ["with space", "space"],
    ["with/slash", "slash"],
    ["", "empty"],
  ])("rejects the invalid template name %j (%s)", (name) => {
    expect(() => applyTemplate({ name, cwd: workspace, templatesRoot }))
      .toThrow(/Invalid template name|Unknown template/);
  });

  it("rejects a manifest whose name does not match its directory", () => {
    // Otherwise --list-templates (which reads manifest.name) advertises a
    // template that applyTemplate (which resolves by directory) cannot find.
    const dir = join(templatesRoot, "alpha");
    mkdirSync(join(dir, "dot-aios"), { recursive: true });
    writeFileSync(join(dir, "template.yaml"), "name: beta\ndescription: mismatched\n");
    writeFileSync(join(dir, "dot-aios", "context.yaml"),
      'schema_version: "1.0"\nname: "{{name}}"\ntype: project\n');

    expect(() => describeTemplate("alpha", templatesRoot))
      .toThrow(/name "beta" must match the directory name "alpha"/);
    // And it must not show up in the listing either.
    expect(listTemplates(templatesRoot).map(t => t.name)).not.toContain("beta");
  });

  it("rejects a template without context.yaml", () => {
    const dir = join(templatesRoot, "bare");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "template.yaml"), "name: bare\ndescription: no context\n");
    expect(() => applyTemplate({ name: "bare", cwd: workspace, templatesRoot }))
      .toThrow(/has no dot-aios\/context\.yaml/);
  });

  it("rejects a manifest whose name is not a valid identifier", () => {
    const dir = join(templatesRoot, "weird");
    mkdirSync(join(dir, "dot-aios"), { recursive: true });
    writeFileSync(join(dir, "template.yaml"), "name: Weird Name\ndescription: x\n");
    expect(() => describeTemplate("weird", templatesRoot)).toThrow(/name must match/);
  });

  it("rejects a dirs entry that escapes the workspace", () => {
    writeFixtureTemplate("evil", {}, "dirs:\n  - ../outside\n");
    expect(() => applyTemplate({ name: "evil", cwd: workspace, templatesRoot, aiosRoot: fakeAios }))
      .toThrow(/Path traversal blocked/);
    expect(existsSync(join(tmp, "outside"))).toBe(false);
  });

  it("rejects a link path that escapes the workspace", () => {
    writeFixtureTemplate("evil", {}, "links:\n  - path: ../outside/link\n    target: .claude\n");
    expect(() => applyTemplate({ name: "evil", cwd: workspace, templatesRoot, aiosRoot: fakeAios }))
      .toThrow(/Path traversal blocked/);
  });

  it("rejects a link target that escapes the AIOS install", () => {
    writeFixtureTemplate("evil", {}, "links:\n  - path: .claude/x\n    target: ../../etc\n");
    expect(() => applyTemplate({ name: "evil", cwd: workspace, templatesRoot, aiosRoot: fakeAios }))
      .toThrow(/Path traversal blocked/);
  });

  it("treats a sibling directory as outside, not as a prefix match", () => {
    // "aios-install-evil" shares a prefix with "aios-install" but is not inside it.
    const sibling = join(tmp, "aios-install-evil");
    mkdirSync(sibling, { recursive: true });
    writeFixtureTemplate("evil", {}, "links:\n  - path: .claude/x\n    target: ../aios-install-evil\n");
    expect(() => applyTemplate({ name: "evil", cwd: workspace, templatesRoot, aiosRoot: fakeAios }))
      .toThrow(/Path traversal blocked/);
  });

  // ─── Helpers ───────────────────────────────────────────

  it("relativize shortens paths inside cwd and leaves others absolute", () => {
    const inside = join(workspace, "cases", "x");
    const outside = join(tmp, "elsewhere");
    expect(relativize([inside, outside], workspace)).toEqual([join("cases", "x"), outside]);
  });

  // ─── The shipped forensics template ────────────────────

  describe("shipped forensics template", () => {
    it("is discoverable from the repository", () => {
      const names = listTemplates(defaultTemplatesRoot()).map(t => t.name);
      expect(names).toContain("forensics");
    });

    it("declares cases/ and tools/ plus the skill link", () => {
      const m = describeTemplate("forensics", defaultTemplatesRoot());
      expect(m.dirs).toEqual(expect.arrayContaining(["cases", "tools"]));
      expect(m.links).toEqual([
        { path: ".claude/skills/host-forensics", target: ".claude/skills/host-forensics" },
      ]);
      expect(m.next_steps?.length ?? 0).toBeGreaterThan(0);
    });

    it("applies cleanly against the real repository", () => {
      const aiosRoot = resolve(defaultTemplatesRoot(), "..", "..");
      const result = applyTemplate({ name: "forensics", cwd: workspace, aiosRoot });

      // The workspace the plan describes
      expect(existsSync(join(workspace, ".aios", "context.yaml"))).toBe(true);
      expect(existsSync(join(workspace, "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(workspace, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(workspace, ".gitignore"))).toBe(true);
      expect(existsSync(join(workspace, "cases"))).toBe(true);
      expect(existsSync(join(workspace, "tools"))).toBe(true);

      // Both agents read .claude/skills/, so one link serves both
      const link = join(workspace, ".claude", "skills", "host-forensics");
      expect(existsSync(join(link, "SKILL.md"))).toBe(true);
      expect(existsSync(join(link, "scripts", "collect.sh"))).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("activates the forensic_analyst persona and a local provider", () => {
      const aiosRoot = resolve(defaultTemplatesRoot(), "..", "..");
      applyTemplate({ name: "forensics", cwd: workspace, aiosRoot });
      const ctx = parseContextYaml(readFileSync(join(workspace, ".aios", "context.yaml"), "utf-8"));
      expect(ctx.personas?.active).toContain("forensic_analyst");
      // Case folders carry user names and log excerpts: keep them local.
      expect(ctx.config.default_provider).toBe("ollama");
    });

    it("asks for strict integrity policies", () => {
      // A case folder is untrusted input: file names, log lines and registry
      // values come from a possibly compromised machine, and a log line can
      // carry an instruction someone planted for the model to read.
      const aiosRoot = resolve(defaultTemplatesRoot(), "..", "..");
      applyTemplate({ name: "forensics", cwd: workspace, aiosRoot });
      const ctx = parseContextYaml(readFileSync(join(workspace, ".aios", "context.yaml"), "utf-8"));
      expect(ctx.security?.integrity_policies).toBe("strict");
    });

    it("routes the forensic patterns to a local provider", () => {
      const aiosRoot = resolve(defaultTemplatesRoot(), "..", "..");
      applyTemplate({ name: "forensics", cwd: workspace, aiosRoot });
      const ctx = parseContextYaml(readFileSync(join(workspace, ".aios", "context.yaml"), "utf-8"));
      for (const p of ["forensic-investigate", "forensic-analyze", "forensic-report"]) {
        expect(ctx.providers?.routing?.[p]).toBe("ollama");
      }
    });

    it("keeps evidence and binaries out of git", () => {
      const aiosRoot = resolve(defaultTemplatesRoot(), "..", "..");
      applyTemplate({ name: "forensics", cwd: workspace, aiosRoot });
      const ignore = readFileSync(join(workspace, ".gitignore"), "utf-8");
      expect(ignore).toContain("cases/");
      expect(ignore).toContain("tools/");
      expect(ignore).toContain(".env");
    });

    it("sets HOST_FORENSICS_TOOLS in the workspace .env", () => {
      const aiosRoot = resolve(defaultTemplatesRoot(), "..", "..");
      applyTemplate({ name: "forensics", cwd: workspace, aiosRoot });
      expect(readFileSync(join(workspace, ".env"), "utf-8")).toContain("HOST_FORENSICS_TOOLS=./tools");
    });
  });
});

describe("workspace templates — refusing to run inside AIOS itself", () => {
  let tmp: string;

  beforeEach(() => { tmp = join(tmpdir(), `aios-tpl-guard-${randomUUID()}`); mkdirSync(tmp, { recursive: true }); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  /**
   * A stray `cd` makes it easy to run this in the AIOS checkout, which would
   * write .aios/, .env and the template's CLAUDE.md over the repository's own.
   */
  it("refuses when cwd is the given AIOS root", () => {
    const templatesRoot = join(tmp, "templates", "workspaces");
    mkdirSync(join(templatesRoot, "alpha", "dot-aios"), { recursive: true });
    writeFileSync(join(templatesRoot, "alpha", "template.yaml"), "name: alpha\ndescription: x\n");
    writeFileSync(join(templatesRoot, "alpha", "dot-aios", "context.yaml"),
      'schema_version: "1.0"\nname: "{{name}}"\ntype: project\n');

    expect(() => applyTemplate({ name: "alpha", cwd: tmp, templatesRoot, aiosRoot: tmp }))
      .toThrow(/Refusing to apply template .* inside the AIOS installation itself/);
  });

  it("refuses when cwd merely looks like the AIOS repository", () => {
    const templatesRoot = join(tmp, "templates", "workspaces");
    mkdirSync(join(templatesRoot, "alpha", "dot-aios"), { recursive: true });
    mkdirSync(join(tmp, "patterns"), { recursive: true });
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(templatesRoot, "alpha", "template.yaml"), "name: alpha\ndescription: x\n");
    writeFileSync(join(templatesRoot, "alpha", "dot-aios", "context.yaml"),
      'schema_version: "1.0"\nname: "{{name}}"\ntype: project\n');

    expect(() => applyTemplate({ name: "alpha", cwd: tmp, templatesRoot, aiosRoot: null }))
      .toThrow(/looks like the AIOS repository/);
  });
});

describe("workspace templates — malformed and hostile templates", () => {
  let tmp: string;
  let templatesRoot: string;
  let workspace: string;

  beforeEach(() => {
    tmp = join(tmpdir(), `aios-tpl-bad-${randomUUID()}`);
    templatesRoot = join(tmp, "templates");
    workspace = join(tmp, "ws");
    mkdirSync(templatesRoot, { recursive: true });
    mkdirSync(workspace, { recursive: true });
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  function manifest(name: string, body: string): string {
    const dir = join(templatesRoot, name);
    mkdirSync(join(dir, "dot-aios"), { recursive: true });
    writeFileSync(join(dir, "template.yaml"), body);
    writeFileSync(join(dir, "dot-aios", "context.yaml"),
      'schema_version: "1.0"\nname: "{{name}}"\ntype: project\n');
    return dir;
  }

  it("reports the template when template.yaml is not an object", () => {
    const dir = join(templatesRoot, "scalar");
    mkdirSync(join(dir, "dot-aios"), { recursive: true });
    writeFileSync(join(dir, "template.yaml"), "just a string\n");
    expect(() => describeTemplate("scalar", templatesRoot)).toThrow(/not an object/);
  });

  it("names the template when its context.yaml does not parse", () => {
    // A bare "YAMLParseError at line 2, column 1" tells the user nothing
    // about which of several templates is broken.
    const dir = manifest("broken", "name: broken\ndescription: x\n");
    writeFileSync(join(dir, "dot-aios", "context.yaml"), "name: x\n\tbad: indentation\n");
    expect(() => applyTemplate({ name: "broken", cwd: workspace, templatesRoot }))
      .toThrow(/Template "broken".*context\.yaml could not be parsed/s);
  });

  it("leaves the workspace untouched when context.yaml does not parse", () => {
    const dir = manifest("broken", "name: broken\ndescription: x\n");
    writeFileSync(join(dir, "dot-aios", "context.yaml"), "name: x\n\tbad: indentation\n");
    expect(() => applyTemplate({ name: "broken", cwd: workspace, templatesRoot })).toThrow();
    expect(existsSync(join(workspace, ".aios"))).toBe(false);
    expect(existsSync(join(workspace, "README.md"))).toBe(false);
  });

  it("ignores manifest fields of the wrong type without creating stray dirs", () => {
    // A one-character slip ("dirs: cases" instead of a list) must not be
    // iterated character-wise into c/, a/, s/, e/.
    manifest("wrongtype", "name: wrongtype\ndescription: x\ndirs: cases\nlinks: nope\nnext_steps: 7\n");
    const m = describeTemplate("wrongtype", templatesRoot);
    expect(m.dirs).toBeUndefined();
    expect(m.links).toBeUndefined();
    expect(m.next_steps).toBeUndefined();

    applyTemplate({ name: "wrongtype", cwd: workspace, templatesRoot });
    for (const stray of ["c", "a", "s", "e", "cases"]) {
      expect(existsSync(join(workspace, stray)), `stray: ${stray}`).toBe(false);
    }
  });

  it("drops non-string members from dirs and next_steps", () => {
    manifest("mixed", "name: mixed\ndescription: x\ndirs:\n  - 1\n  - cases\n  - null\nnext_steps:\n  - ok\n  - 2\n");
    const m = describeTemplate("mixed", templatesRoot);
    expect(m.dirs).toEqual(["cases"]);
    expect(m.next_steps).toEqual(["ok"]);
  });

  it("warns about a symlink inside the template tree and does not copy it", () => {
    const dir = manifest("linky", "name: linky\ndescription: x\n");
    writeFileSync(join(tmp, "outside-secret.txt"), "secret");
    symlinkSync(join(tmp, "outside-secret.txt"), join(dir, "sneaky.txt"));

    const result = applyTemplate({ name: "linky", cwd: workspace, templatesRoot });
    expect(existsSync(join(workspace, "sneaky.txt"))).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/non-regular file in template/);
  });

  it("describeTemplate rejects an invalid template name", () => {
    expect(() => describeTemplate("../escape", templatesRoot)).toThrow(/Invalid template name/);
    expect(() => describeTemplate("UPPER", templatesRoot)).toThrow(/Invalid template name/);
  });

  it("ignores a plain file sitting in the templates root", () => {
    manifest("good", "name: good\ndescription: x\n");
    writeFileSync(join(templatesRoot, "stray.txt"), "not a template");
    expect(listTemplates(templatesRoot).map(t => t.name)).toEqual(["good"]);
  });

  it("ignores a directory whose name is not a valid template name", () => {
    manifest("good", "name: good\ndescription: x\n");
    mkdirSync(join(templatesRoot, "Upper"), { recursive: true });
    writeFileSync(join(templatesRoot, "Upper", "template.yaml"), "name: Upper\ndescription: x\n");
    expect(listTemplates(templatesRoot).map(t => t.name)).toEqual(["good"]);
  });

  it("returns an empty list for an existing but empty templates root", () => {
    expect(listTemplates(templatesRoot)).toEqual([]);
  });

  it("says no templates are available when none exist", () => {
    expect(() => applyTemplate({ name: "any", cwd: workspace, templatesRoot }))
      .toThrow(/Available: \(none\)/);
  });

  it("falls back to an empty description when the manifest has none", () => {
    manifest("nodesc", "name: nodesc\n");
    expect(describeTemplate("nodesc", templatesRoot).description).toBe("");
  });

  it("honours readOnly: false from the template context", () => {
    const dir = manifest("rw", "name: rw\ndescription: x\n");
    writeFileSync(join(dir, "dot-aios", "context.yaml"),
      'schema_version: "1.0"\nname: "{{name}}"\ntype: project\naios:\n  path: ""\n  readOnly: false\n');
    const result = applyTemplate({ name: "rw", cwd: workspace, templatesRoot, aiosRoot: "/some/aios" });
    expect(result.context.aios?.readOnly).toBe(false);
  });
});
