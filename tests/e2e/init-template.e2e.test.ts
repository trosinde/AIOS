/**
 * End-to-end tests for `aios init --template` and `--list-templates`.
 *
 * These branches live in `src/cli.ts`, which is excluded from unit coverage
 * ("CLI entry point — interactive, tested via e2e"), so without this file
 * they had no automated coverage of any kind. Two failure modes in
 * particular are invisible to unit tests:
 *
 *   1. A wrong Commander option key (`opts.listTemplates` / `opts.template`)
 *      makes the flag a silent no-op that falls through into the interactive
 *      wizard — in CI that is a hang, not a failure.
 *   2. Writing a listing to stderr instead of stdout breaks
 *      `aios init --list-templates | grep ...` while every assertion on
 *      "did it print something" still passes.
 *
 * Each test spawns the real CLI with an isolated HOME and, where it matters,
 * an isolated cwd, so nothing touches the developer's checkout.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, lstatSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "src", "cli.ts");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd: string = REPO_ROOT): CliResult {
  const result = spawnSync(TSX_BIN, [CLI_ENTRY, ...args], {
    cwd,
    env,
    encoding: "utf-8",
    timeout: 60_000,
    // No stdin: if a branch ever falls through to the interactive wizard,
    // this fails fast instead of hanging the suite.
    input: "",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("aios init --template (e2e)", () => {
  let home: string;
  let workspace: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "aios-e2e-tpl-home-"));
    workspace = mkdtempSync(join(tmpdir(), "aios-e2e-tpl-ws-"));
    env = { ...process.env, HOME: home, NO_COLOR: "1" };
  });

  afterEach(() => {
    for (const d of [home, workspace]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("lists the forensics template on stdout", () => {
    const r = runCli(["init", "--list-templates"], env);
    expect(r.status).toBe(0);
    // stdout, not stderr: the listing is a result (CLAUDE.md convention),
    // and `| grep forensics` has to work.
    expect(r.stdout).toContain("forensics");
  });

  it("sets up a workspace from the forensics template", () => {
    const r = runCli(
      ["init", "--template", "forensics", "--aios-path", REPO_ROOT],
      env,
      workspace,
    );
    expect(r.status).toBe(0);

    for (const f of [
      join(".aios", "context.yaml"),
      join(".aios", "agent-instructions.md"),
      "CLAUDE.md",
      "AGENTS.md",
      ".gitignore",
      ".env",
      "cases",
      "tools",
    ]) {
      expect(existsSync(join(workspace, f)), `missing: ${f}`).toBe(true);
    }

    // The skill must be reachable *through* the link, and be a link — that
    // is what makes `aios update` reach it.
    const link = join(workspace, ".claude", "skills", "host-forensics");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(link, "SKILL.md"), "utf-8")).toContain("host-forensics");
    expect(existsSync(join(link, "scripts", "collect.sh"))).toBe(true);

    expect(readFileSync(join(workspace, ".env"), "utf-8")).toContain("HOST_FORENSICS_TOOLS");
  });

  it("names the available templates when the requested one is unknown", () => {
    const r = runCli(["init", "--template", "nope"], env, workspace);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Unknown template "nope"/);
    expect(r.stderr).toContain("forensics");
    // Nothing half-written
    expect(existsSync(join(workspace, ".aios"))).toBe(false);
  });

  it("refuses to run inside the AIOS checkout and writes nothing", () => {
    // The only thing standing between a stray `cd` and the template's
    // CLAUDE.md overwriting the repository's own.
    const before = spawnSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT, encoding: "utf-8",
    }).stdout;

    const r = runCli(["init", "--template", "forensics"], env, REPO_ROOT);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/AIOS (installation itself|repository)/);

    const after = spawnSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT, encoding: "utf-8",
    }).stdout;
    expect(after).toBe(before);
  });

  it("registers the new workspace in the federation registry", () => {
    const setup = runCli(
      ["init", "--template", "forensics", "--aios-path", REPO_ROOT],
      env,
      workspace,
    );
    expect(setup.status).toBe(0);

    // registerContext sits inside a bare `catch {}` in cli.ts, so a silent
    // regression there would otherwise be invisible.
    const list = runCli(["context", "list"], env, workspace);
    const name = workspace.split(/[/\\]/).pop()!;
    expect(list.stdout + list.stderr).toContain(name);
  });

  it("does not overwrite a hand-edited context.yaml on a second run", () => {
    const first = runCli(
      ["init", "--template", "forensics", "--aios-path", REPO_ROOT],
      env,
      workspace,
    );
    expect(first.status).toBe(0);

    const ctxPath = join(workspace, ".aios", "context.yaml");
    const edited = readFileSync(ctxPath, "utf-8") + "\n# user edit\n";
    writeFileSync(ctxPath, edited);

    const second = runCli(
      ["init", "--template", "forensics", "--aios-path", REPO_ROOT],
      env,
      workspace,
    );
    expect(second.status).toBe(0);
    expect(readFileSync(ctxPath, "utf-8")).toBe(edited);
  });
});
