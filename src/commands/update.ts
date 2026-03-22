import { execSync } from "child_process";
import { existsSync, readFileSync, cpSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import chalk from "chalk";
import ora from "ora";
import { getAiosHome } from "../utils/config.js";

interface UpdateOptions {
  check?: boolean;
}

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

export function readVersion(repoPath: string): string {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return "unknown";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function syncNewFiles(source: string, target: string): void {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, force: false });
}

export function detectRepoPath(): string {
  // 1. Dev-Modus: Prüfe ob die CLI selbst in einem AIOS-Repo läuft
  let dir = import.meta.dirname;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".git")) && existsSync(join(dir, "package.json"))) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
        if (pkg.name === "aios") return dir;
      } catch { /* weiter suchen */ }
    }
    dir = dirname(dir);
  }

  // 2. Standard: ~/.aios/repo
  const installed = join(getAiosHome(), "repo");
  if (existsSync(join(installed, ".git"))) return installed;

  throw new Error("AIOS Repository nicht gefunden");
}

export async function runUpdate(options: UpdateOptions): Promise<void> {
  const aiosHome = getAiosHome();
  let repoPath: string;
  try {
    repoPath = detectRepoPath();
  } catch {
    console.error(chalk.red("AIOS Repository nicht gefunden"));
    console.error(chalk.gray("Installiere AIOS zuerst mit install.sh"));
    process.exit(1);
  }

  const isDevMode = repoPath !== join(aiosHome, "repo");
  if (isDevMode) {
    console.error(chalk.cyan("Dev-Modus: aktualisiere lokales Repository ") + chalk.gray(`(${repoPath})`));
  }

  const oldVersion = readVersion(repoPath);

  // Fetch latest changes
  const fetchSpinner = ora({ text: "Prüfe auf Updates...", stream: process.stderr }).start();
  try {
    run("git fetch origin main", repoPath);
  } catch {
    fetchSpinner.fail("Git fetch fehlgeschlagen — Netzwerkverbindung prüfen");
    process.exit(1);
  }

  // Check how many commits behind
  let pendingCount = 0;
  try {
    pendingCount = parseInt(run("git rev-list HEAD..origin/main --count", repoPath), 10);
    if (Number.isNaN(pendingCount)) pendingCount = 0;
  } catch {
    fetchSpinner.fail("Konnte Update-Status nicht ermitteln");
    process.exit(1);
  }

  if (pendingCount === 0) {
    fetchSpinner.succeed(chalk.green("AIOS ist bereits aktuell") + chalk.gray(` (v${oldVersion})`));
    return;
  }

  fetchSpinner.succeed(`${pendingCount} neue(r) Commit(s) verfügbar`);

  // --check: only report, don't install
  if (options.check) {
    console.error(chalk.cyan(`  Update verfügbar: ${pendingCount} neue(r) Commit(s)`));
    console.error(chalk.gray('  Führe "aios update" aus um zu aktualisieren'));
    return;
  }

  // Save current commit for rollback
  const rollbackRef = run("git rev-parse HEAD", repoPath);

  // Pull changes
  const pullSpinner = ora({ text: "Lade Updates...", stream: process.stderr }).start();
  try {
    run("git pull origin main", repoPath);
    pullSpinner.succeed("Quellcode aktualisiert");
  } catch {
    pullSpinner.fail("Git pull fehlgeschlagen — lokale Änderungen im Repo?");
    console.error(chalk.gray(`  Versuche: cd ${repoPath} && git stash && aios update`));
    process.exit(1);
  }

  // Install dependencies
  const depsSpinner = ora({ text: "Installiere Dependencies...", stream: process.stderr }).start();
  try {
    run("npm install --silent", repoPath);
    depsSpinner.succeed("Dependencies installiert");
  } catch {
    depsSpinner.fail("npm install fehlgeschlagen — Rollback...");
    run(`git reset --hard ${rollbackRef}`, repoPath);
    console.error(chalk.yellow("  Rollback auf vorherige Version durchgeführt"));
    process.exit(1);
  }

  // Build
  const buildSpinner = ora({ text: "Kompiliere TypeScript...", stream: process.stderr }).start();
  try {
    run("npm run build --silent", repoPath);
    buildSpinner.succeed("Build erfolgreich");
  } catch {
    buildSpinner.fail("Build fehlgeschlagen — Rollback...");
    run(`git reset --hard ${rollbackRef}`, repoPath);
    run("npm run build --silent", repoPath);
    console.error(chalk.yellow("  Rollback auf vorherige Version durchgeführt"));
    process.exit(1);
  }

  // Sync patterns & personas (new ones only, don't overwrite existing)
  const syncSpinner = ora({ text: "Synchronisiere Patterns & Personas...", stream: process.stderr }).start();
  syncNewFiles(join(repoPath, "patterns"), join(aiosHome, "patterns"));
  syncNewFiles(join(repoPath, "personas"), join(aiosHome, "personas"));
  syncSpinner.succeed("Patterns & Personas synchronisiert");

  // Summary
  const newVersion = readVersion(repoPath);
  console.error();
  console.error(chalk.green.bold("  AIOS erfolgreich aktualisiert!"));
  if (oldVersion !== newVersion) {
    console.error(chalk.gray(`  Version: ${oldVersion} → ${newVersion}`));
  }
  console.error(chalk.gray(`  Commits: ${pendingCount} neue(r) Commit(s) installiert`));
  console.error();
}
