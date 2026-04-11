import { spawn } from "child_process";
import { createInterface } from "readline";
import chalk from "chalk";
import type { McpServerConfig, McpInstallCommand } from "../types.js";

// ─── Types ─────────────────────────────────────────────────

export type InstallStatus =
  | "already_installed"
  | "no_install_detect"
  | "installed"
  | "install_failed"
  | "no_method"
  | "post_install_failed"
  | "skipped_by_user";

export interface InstallResult {
  server: string;
  status: InstallStatus;
  via?: string;
  error?: string;
  hint?: string;
  /** Whether the final state is "usable" (installed or already installed) */
  ok: boolean;
}

export interface McpInstallOptions {
  /** Install only this server; undefined means all configured servers */
  server?: string;
  /** Report-only mode, do not run any install commands */
  check?: boolean;
  /** Skip interactive prompts, assume "yes" for auto-install */
  nonInteractive?: boolean;
  /** Skip servers that have no install_commands configured (do not warn) */
  onlyInstallable?: boolean;
}

// ─── Low-level helpers (exported for tests & reuse) ────────

/**
 * Check whether a CLI tool is available in PATH.
 * Uses `which` on Unix and `where` on Windows.
 */
export function isToolAvailable(tool: string): Promise<boolean> {
  const which = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    const p = spawn(which, [tool], { stdio: "ignore" });
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

/**
 * Run an argv-style command, capturing stdout and stderr. Returns
 * { code, stdout, stderr }. Does NOT throw on non-zero exit codes.
 */
export function runCommand(
  argv: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise((resolve) => {
    if (argv.length === 0) {
      resolve({ code: 1, stdout: "", stderr: "empty command" });
      return;
    }
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

/**
 * Run the `install_detect` command to determine if the server's
 * prerequisites are already satisfied. Returns true if detect succeeds
 * (exit 0) or if no detect command is configured (optimistic default —
 * the caller decides whether to still attempt install).
 */
export async function isServerInstalled(cfg: McpServerConfig): Promise<boolean> {
  if (!cfg.install_detect || cfg.install_detect.length === 0) return true;
  const result = await runCommand(cfg.install_detect, { timeoutMs: 15_000 });
  return result.code === 0;
}

/**
 * Find the first install_command whose `detect` tool is available.
 * Returns undefined if none of the declared methods can be used.
 */
export async function pickInstallMethod(
  commands: McpInstallCommand[] | undefined,
): Promise<McpInstallCommand | undefined> {
  if (!commands || commands.length === 0) return undefined;
  for (const c of commands) {
    if (!c.detect || !Array.isArray(c.run) || c.run.length === 0) continue;
    if (await isToolAvailable(c.detect)) return c;
  }
  return undefined;
}

// ─── Interactive prompt (TTY only) ─────────────────────────

async function askYN(prompt: string, defaultYes: boolean): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  return new Promise((resolve) => {
    rl.question(`  ${prompt} ${hint}: `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes" || a === "j" || a === "ja");
    });
  });
}

// ─── Single server install ─────────────────────────────────

/**
 * Install (or verify) a single MCP server.
 *
 * Flow:
 *   1. If `install_detect` succeeds → `already_installed` (OK)
 *   2. If `check` is set → return status without installing
 *   3. If interactive and not `nonInteractive` → prompt user
 *   4. Pick first available install_command method
 *   5. Run the command, capture result
 *   6. On success, optionally run post_install
 *   7. Re-run install_detect to verify
 */
export async function installServer(
  name: string,
  cfg: McpServerConfig,
  opts: McpInstallOptions,
): Promise<InstallResult> {
  // Step 1: already installed?
  if (await isServerInstalled(cfg)) {
    // Distinguish "no detect" from "real OK"
    if (!cfg.install_detect || cfg.install_detect.length === 0) {
      return {
        server: name,
        status: "no_install_detect",
        ok: true,
        hint: cfg.install_hint,
      };
    }
    return { server: name, status: "already_installed", ok: true };
  }

  // Step 2: check-only mode
  if (opts.check) {
    return {
      server: name,
      status: "install_failed",
      ok: false,
      hint: cfg.install_hint,
    };
  }

  // Step 3: interactive confirmation
  const isTTY = Boolean(process.stdin.isTTY && process.stderr.isTTY);
  if (!opts.nonInteractive && isTTY) {
    console.error(
      chalk.yellow(`  ⚠ MCP-Server "${name}" ist nicht installiert.`),
    );
    if (cfg.install_hint) {
      console.error(chalk.gray(`    Hint: ${cfg.install_hint}`));
    }
    const proceed = await askYN(`    Jetzt installieren?`, true);
    if (!proceed) {
      return {
        server: name,
        status: "skipped_by_user",
        ok: false,
        hint: cfg.install_hint,
      };
    }
  }

  // Step 4: pick an install method
  const method = await pickInstallMethod(cfg.install_commands);
  if (!method) {
    return {
      server: name,
      status: "no_method",
      ok: false,
      hint: cfg.install_hint,
    };
  }

  // Step 5: run the install
  console.error(
    chalk.cyan(`  → Installiere ${name} via ${method.label ?? method.detect}…`),
  );
  const installResult = await runCommand(method.run);
  if (installResult.code !== 0) {
    return {
      server: name,
      status: "install_failed",
      ok: false,
      via: method.detect,
      error: installResult.stderr.trim() || installResult.stdout.trim() || `exit ${installResult.code}`,
      hint: cfg.install_hint,
    };
  }

  // Step 6: post_install (e.g. `mempalace init`)
  if (cfg.post_install && cfg.post_install.length > 0) {
    console.error(chalk.gray(`  → Post-Install: ${cfg.post_install.join(" ")}`));
    const postResult = await runCommand(cfg.post_install);
    if (postResult.code !== 0) {
      // Post-install failure is not fatal — package is installed, maybe
      // the init step is optional or already done.
      console.error(
        chalk.yellow(
          `    Warnung: post_install fehlgeschlagen (${postResult.stderr.trim() || `exit ${postResult.code}`})`,
        ),
      );
      return {
        server: name,
        status: "post_install_failed",
        ok: true, // package is installed, only the init step failed
        via: method.detect,
        error: postResult.stderr.trim() || `exit ${postResult.code}`,
      };
    }
  }

  // Step 7: verify
  if (await isServerInstalled(cfg)) {
    return { server: name, status: "installed", ok: true, via: method.detect };
  }

  return {
    server: name,
    status: "install_failed",
    ok: false,
    via: method.detect,
    error: "install command succeeded but install_detect still fails",
    hint: cfg.install_hint,
  };
}

// ─── Reporting ─────────────────────────────────────────────

export function formatResult(r: InstallResult): string {
  switch (r.status) {
    case "already_installed":
      return chalk.green(`  ✓ ${r.server} (bereits installiert)`);
    case "no_install_detect":
      return chalk.gray(`  · ${r.server} (kein install_detect konfiguriert, übersprungen)`);
    case "installed":
      return chalk.green(`  ✓ ${r.server} installiert via ${r.via}`);
    case "install_failed":
      return chalk.red(`  ✗ ${r.server} Install fehlgeschlagen`) +
        (r.via ? chalk.gray(` (${r.via})`) : "") +
        (r.error ? "\n    " + chalk.gray(r.error.split("\n")[0]) : "") +
        (r.hint ? "\n    " + chalk.gray("→ " + r.hint) : "");
    case "no_method":
      return chalk.yellow(`  ⚠ ${r.server} keine verfügbare Install-Methode`) +
        (r.hint ? "\n    " + chalk.gray("→ " + r.hint) : "");
    case "post_install_failed":
      return chalk.yellow(`  ⚠ ${r.server} installiert, post_install fehlgeschlagen`) +
        (r.error ? "\n    " + chalk.gray(r.error.split("\n")[0]) : "");
    case "skipped_by_user":
      return chalk.gray(`  · ${r.server} übersprungen`) +
        (r.hint ? "\n    " + chalk.gray("→ " + r.hint) : "");
  }
}

// ─── Top-level CLI entry point ─────────────────────────────

/**
 * Shared helper: enumerate the servers to process based on options.
 * Exported so `aios update` can call the same resolution.
 */
export function resolveServers(
  allServers: Record<string, McpServerConfig>,
  opts: McpInstallOptions,
): Array<[string, McpServerConfig]> {
  const entries = opts.server
    ? (allServers[opts.server] ? [[opts.server, allServers[opts.server]] as [string, McpServerConfig]] : [])
    : Object.entries(allServers);
  if (opts.onlyInstallable) {
    return entries.filter(([, cfg]) =>
      Array.isArray(cfg.install_commands) && cfg.install_commands.length > 0,
    );
  }
  return entries;
}

/**
 * Run install for one or all configured MCP servers. Used by the
 * `aios mcp install` CLI command and by `aios update`.
 *
 * Returns the collected results (also used for exit-code derivation
 * by the CLI wrapper).
 */
export async function installMcpServers(
  allServers: Record<string, McpServerConfig>,
  opts: McpInstallOptions,
): Promise<InstallResult[]> {
  const entries = resolveServers(allServers, opts);
  if (entries.length === 0) {
    if (opts.server) {
      console.error(chalk.red(`  ✗ MCP-Server "${opts.server}" ist nicht konfiguriert`));
    } else if (!opts.onlyInstallable) {
      console.error(chalk.gray("  (keine MCP-Server konfiguriert)"));
    }
    return [];
  }

  const results: InstallResult[] = [];
  for (const [name, cfg] of entries) {
    const result = await installServer(name, cfg, opts);
    results.push(result);
    console.error(formatResult(result));
  }
  return results;
}

/**
 * CLI wrapper: loads config, runs installs, exits with a status code
 * reflecting overall success.
 */
export async function runMcpInstall(opts: McpInstallOptions): Promise<void> {
  const { loadConfig } = await import("../utils/config.js");
  const config = loadConfig();
  const servers = config.mcp?.servers ?? {};

  console.error(chalk.bold("MCP-Server Installation"));
  console.error("");

  const results = await installMcpServers(servers, opts);

  console.error("");
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.error(chalk.bold(`  Ergebnis: ${ok} OK, ${failed} fehlgeschlagen`));

  // Exit non-zero only when interactive (so install.sh calls with
  // --non-interactive never break the installer even if a server has no
  // usable install method).
  if (failed > 0 && !opts.nonInteractive) {
    process.exit(1);
  }
}
