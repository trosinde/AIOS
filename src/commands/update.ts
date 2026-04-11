import { execSync } from "child_process";
import {
  existsSync,
  readFileSync,
  cpSync,
  mkdirSync,
  rmSync,
  renameSync,
  statSync,
} from "fs";
import { join } from "path";
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

/**
 * Migrate a pre-LanceDB AIOS install to the new KnowledgeBus layout.
 *
 * Idempotent: every step checks for existence first and only acts on
 * what is actually stale. Safe to call on a fresh install (no-op).
 *
 * Steps:
 *   1. The old `~/.aios/knowledge/bus.db` was a single SQLite file.
 *      The new layout expects `~/.aios/knowledge/` to be a directory
 *      that holds the LanceDB tables. If we find the file, back it up
 *      to `bus.db.pre-lance.bak` and remove it so the directory can
 *      be created.
 *   2. The old MemPalace integration shipped two extra patterns
 *      (memory_recall_fetch, memory_store_persist) that no longer
 *      exist in the repo. The pattern sync uses `force: false` so it
 *      cannot delete stale patterns on its own — we delete them here.
 *   3. The current memory_recall and memory_store patterns were
 *      rewritten as `type: kb`. Force-overwrite the user's local
 *      copies with the version from the repo, but only when the local
 *      copy is the legacy `type: llm` flavor — never clobber a custom
 *      pattern.
 *   4. Best-effort: if the `claude` CLI is available and `mempalace`
 *      is registered as a user-scope MCP server, unregister it.
 *
 * Migration of existing knowledge data is intentionally NOT automatic:
 * old SQLite rows would need to be re-embedded, which requires Ollama
 * online and is a one-shot operation the user should consciously
 * trigger. We leave the .bak file in place and print a hint.
 */
export function migrateFromLegacyKb(aiosHome: string, repoPath: string): {
  changes: string[];
  backupPath?: string;
} {
  const changes: string[] = [];
  let backupPath: string | undefined;

  // Step 1: legacy bus.db file → directory layout
  const knowledgeDir = join(aiosHome, "knowledge");
  if (existsSync(knowledgeDir)) {
    try {
      const st = statSync(knowledgeDir);
      if (st.isFile()) {
        // Old single-file SQLite KB. Move it aside so the new
        // directory can be created on first KB use.
        backupPath = `${knowledgeDir}.pre-lance.bak`;
        renameSync(knowledgeDir, backupPath);
        changes.push(`legacy SQLite KB → ${backupPath}`);
      }
    } catch {
      /* ignore stat errors */
    }
  }
  // Also handle the explicit bus.db file if it sits inside a directory
  const legacyDbFile = join(aiosHome, "knowledge", "bus.db");
  if (existsSync(legacyDbFile)) {
    try {
      backupPath = `${legacyDbFile}.pre-lance.bak`;
      renameSync(legacyDbFile, backupPath);
      changes.push(`legacy bus.db → ${backupPath}`);
    } catch {
      /* ignore */
    }
  }

  // Step 2: stale tool-script patterns
  const patternsHome = join(aiosHome, "patterns");
  for (const stale of ["memory_recall_fetch", "memory_store_persist"]) {
    const dir = join(patternsHome, stale);
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        changes.push(`removed stale pattern ${stale}`);
      } catch {
        /* ignore */
      }
    }
  }

  // Step 3: force-overwrite legacy memory_recall / memory_store
  // patterns when the local copy is the pre-kb version
  for (const name of ["memory_recall", "memory_store"]) {
    const localFile = join(patternsHome, name, "system.md");
    const repoFile = join(repoPath, "patterns", name, "system.md");
    if (!existsSync(localFile) || !existsSync(repoFile)) continue;
    try {
      const local = readFileSync(localFile, "utf-8");
      // Pre-kb patterns have no `type: kb` line. Newer ones do.
      // We only overwrite when the local copy is missing it AND the
      // repo copy has it — preserves user customizations of the new
      // version while replacing legacy ones.
      const localIsKb = /^type:\s*kb\b/m.test(local);
      const repoContent = readFileSync(repoFile, "utf-8");
      const repoIsKb = /^type:\s*kb\b/m.test(repoContent);
      if (!localIsKb && repoIsKb) {
        cpSync(repoFile, localFile);
        changes.push(`upgraded pattern ${name} to type: kb`);
      }
    } catch {
      /* ignore */
    }
  }

  // Step 4: best-effort unregister mempalace from Claude Code
  try {
    execSync("command -v claude >/dev/null 2>&1");
    const list = execSync("claude mcp list 2>/dev/null", { encoding: "utf-8" });
    if (list.includes("mempalace")) {
      execSync("claude mcp remove -s user mempalace 2>/dev/null");
      changes.push("unregistered mempalace from Claude Code MCP user scope");
    }
  } catch {
    /* claude not installed or no mempalace registered — ignore */
  }

  return { changes, backupPath };
}

/**
 * Verify that the active embedding provider can serve the
 * KnowledgeBus. The check is non-fatal: KB still works without it,
 * but semanticSearch returns degenerate results until embeddings are
 * available. We print an actionable hint instead of erroring.
 */
export function checkEmbeddingProvider(): {
  ok: boolean;
  hint?: string;
} {
  try {
    // Best-effort: try the default Ollama endpoint with a tiny prompt.
    const out = execSync(
      'curl -s -m 3 -X POST http://localhost:11434/api/embeddings -d \'{"model":"nomic-embed-text","prompt":"x"}\'',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    if (!out || out.includes('"error"')) {
      const hint = out.includes("not found")
        ? "Ollama läuft, aber Modell fehlt: 'ollama pull nomic-embed-text'"
        : `Ollama antwortet nicht wie erwartet: ${out.slice(0, 80)}`;
      return { ok: false, hint };
    }
    // Cheap sanity check: response should contain "embedding"
    if (!out.includes('"embedding"')) {
      return { ok: false, hint: "Ollama-Antwort enthält kein embedding-Feld" };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      hint:
        "Ollama nicht erreichbar (http://localhost:11434). Installiere via 'curl https://ollama.com/install.sh | sh' und 'ollama pull nomic-embed-text'.",
    };
  }
}

export async function runUpdate(options: UpdateOptions): Promise<void> {
  const aiosHome = getAiosHome();
  const repoPath = join(aiosHome, "repo");

  // Verify git repo exists
  if (!existsSync(join(repoPath, ".git"))) {
    console.error(chalk.red("AIOS Repository nicht gefunden unter: " + repoPath));
    console.error(chalk.gray("Installiere AIOS zuerst mit install.sh"));
    process.exit(1);
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

  // Migrate from legacy KB layout (no-op on fresh installs)
  const migrationSpinner = ora({
    text: "Prüfe Legacy-KnowledgeBus-Layout...",
    stream: process.stderr,
  }).start();
  const migration = migrateFromLegacyKb(aiosHome, repoPath);
  if (migration.changes.length === 0) {
    migrationSpinner.succeed("KnowledgeBus-Layout aktuell");
  } else {
    migrationSpinner.succeed(`KnowledgeBus migriert (${migration.changes.length} Änderungen)`);
    for (const change of migration.changes) {
      console.error(chalk.gray(`    • ${change}`));
    }
    if (migration.backupPath) {
      console.error(
        chalk.yellow(
          `    ⚠ Alte SQLite-KB unter ${migration.backupPath} gesichert — manuelle Re-Embedding-Migration ist (noch) nicht automatisch.`,
        ),
      );
    }
  }

  // Sync patterns & personas (new ones only, don't overwrite existing)
  const syncSpinner = ora({ text: "Synchronisiere Patterns & Personas...", stream: process.stderr }).start();
  syncNewFiles(join(repoPath, "patterns"), join(aiosHome, "patterns"));
  syncNewFiles(join(repoPath, "personas"), join(aiosHome, "personas"));
  syncSpinner.succeed("Patterns & Personas synchronisiert");

  // Embedding provider sanity check (non-fatal)
  const embedSpinner = ora({
    text: "Prüfe Embedding-Provider (Ollama)...",
    stream: process.stderr,
  }).start();
  const embedCheck = checkEmbeddingProvider();
  if (embedCheck.ok) {
    embedSpinner.succeed("Embedding-Provider erreichbar");
  } else {
    embedSpinner.warn(
      "Embedding-Provider nicht erreichbar — semantische Suche bleibt offline bis behoben",
    );
    if (embedCheck.hint) {
      console.error(chalk.gray(`    → ${embedCheck.hint}`));
    }
  }

  // Scan and refresh context registry
  const scanSpinner = ora({ text: "Aktualisiere Kontext-Registry...", stream: process.stderr }).start();
  try {
    const { scanContexts } = await import("../context/scanner.js");
    const scanPaths = [process.cwd(), aiosHome];
    const scanResult = scanContexts(scanPaths);
    const total = scanResult.discovered.length + scanResult.updated.length;
    const parts: string[] = [`${total} Kontext(e)`];
    if (scanResult.discovered.length > 0) parts.push(`${scanResult.discovered.length} neu`);
    if (scanResult.stale.length > 0) parts.push(`${scanResult.stale.length} entfernt`);
    if (scanResult.brokenLinks.length > 0) parts.push(`${scanResult.brokenLinks.length} defekte Links`);
    scanSpinner.succeed(`Kontext-Registry: ${parts.join(", ")}`);

    // Show details for discovered contexts
    for (const ctx of scanResult.discovered) {
      console.error(chalk.green(`    + ${ctx.entry.name}`) + chalk.gray(` (${ctx.entry.type})`));
      if (ctx.entry.description) {
        console.error(chalk.gray(`      ${ctx.entry.description}`));
      }
      if (ctx.entry.capabilities.length > 0) {
        console.error(chalk.cyan(`      Fähigkeiten: ${ctx.entry.capabilities.join(", ")}`));
      }
    }

    // Show details for updated contexts
    for (const ctx of scanResult.updated) {
      console.error(chalk.blue(`    ~ ${ctx.entry.name}`) + chalk.gray(` (${ctx.entry.type})`));
      if (ctx.entry.capabilities.length > 0) {
        console.error(chalk.cyan(`      Fähigkeiten: ${ctx.entry.capabilities.join(", ")}`));
      }
    }

    // Show stale contexts
    for (const ctx of scanResult.stale) {
      console.error(chalk.yellow(`    - ${ctx.name}`) + chalk.gray(` (${ctx.path})`));
    }

    // Show broken links
    for (const bl of scanResult.brokenLinks) {
      console.error(chalk.red(`    ✗ ${bl.context} → ${bl.linkName} (${bl.path})`));
    }
  } catch {
    scanSpinner.warn("Kontext-Scan übersprungen");
  }


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
