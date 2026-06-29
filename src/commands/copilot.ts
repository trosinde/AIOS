/**
 * `aios copilot` – Registriert AIOS als MCP-Server in GitHub Copilot CLI.
 *
 * GitHub Copilot CLI liest lokale MCP-Server aus `~/.copilot/mcp-config.json`
 * (überschreibbar via `COPILOT_HOME`). Dieser Befehl mergt einen `aios`-Eintrag
 * idempotent und nicht-destruktiv in diese Datei.
 *
 * Siehe docs/requirements/REQ-001-github-copilot-cli.md und docs/MCP.md.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import chalk from "chalk";

/** Name des AIOS-Eintrags in der Copilot-MCP-Konfiguration */
export const AIOS_SERVER_KEY = "aios";

/** Ein lokaler MCP-Server-Eintrag im Copilot-CLI-Format */
export interface CopilotMcpServer {
  type: "local";
  command: string;
  args: string[];
  tools: string[];
  env: Record<string, string>;
}

/** Struktur der `~/.copilot/mcp-config.json` (nur die für uns relevanten Felder) */
export interface CopilotMcpConfig {
  mcpServers: Record<string, CopilotMcpServer>;
  [key: string]: unknown;
}

export interface CopilotInstallOptions {
  /** Nur das resultierende JSON ausgeben, nichts schreiben */
  print?: boolean;
  /** Kommando-Override (z.B. "node") */
  command?: string;
  /** Argument-Override (Komma-getrennt oder als Array) */
  args?: string | string[];
}

/**
 * Pfad zur Copilot-CLI-MCP-Konfiguration.
 * `COPILOT_HOME` hat Vorrang, sonst `~/.copilot/mcp-config.json`.
 */
export function copilotConfigPath(): string {
  const home = process.env.COPILOT_HOME?.trim() || join(homedir(), ".copilot");
  return join(home, "mcp-config.json");
}

/**
 * Ermittelt das Kommando, das Copilot ausführen soll, um den AIOS-MCP-Server
 * zu starten. Default: das globale `aios`-Binary auf dem PATH. Wenn AIOS nur
 * lokal (z.B. aus dem Repo) läuft, wird auf `node <abs>/dist/cli.js` ausgewichen.
 */
export function resolveAiosCommand(): { command: string; args: string[] } {
  // process.argv[1] zeigt auf das gerade laufende CLI-Entrypoint.
  // Bei globaler Installation ist das ein Symlink namens "aios" → wir nutzen
  // schlicht "aios" auf dem PATH. Bei lokalem Lauf (dist/cli.js) referenzieren
  // wir die kompilierte Datei absolut, damit Copilot sie zuverlässig findet.
  const entry = process.argv[1] ?? "";
  const isGlobalBin = /(^|[\\/])aios$/.test(entry);
  if (isGlobalBin) {
    return { command: "aios", args: ["mcp-server"] };
  }

  // Lokaler Lauf: bevorzugt die kompilierte dist/cli.js (node-ausführbar).
  // __dirname dieses Moduls liegt unter dist/commands/ bzw. src/commands/.
  const here = dirname(fileURLToPath(import.meta.url));
  const distCli = resolve(here, "..", "cli.js");
  if (existsSync(distCli)) {
    return { command: "node", args: [distCli, "mcp-server"] };
  }

  // Letzter Fallback: auf PATH hoffen.
  return { command: "aios", args: ["mcp-server"] };
}

/** Baut den AIOS-Server-Eintrag (reine Funktion, kein I/O). */
export function buildAiosServerEntry(
  opts: CopilotInstallOptions = {},
): CopilotMcpServer {
  const resolved = resolveAiosCommand();
  const command = opts.command?.trim() || resolved.command;

  let args: string[];
  if (Array.isArray(opts.args)) {
    args = opts.args;
  } else if (typeof opts.args === "string" && opts.args.trim().length > 0) {
    args = opts.args.split(",").map((a) => a.trim()).filter(Boolean);
  } else {
    args = opts.command?.trim() ? ["mcp-server"] : resolved.args;
  }

  return {
    type: "local",
    command,
    args,
    tools: ["*"],
    env: {},
  };
}

/**
 * Mergt einen Server-Eintrag idempotent in eine bestehende Config.
 * Fremde Server bleiben erhalten; nur `key` wird gesetzt/überschrieben.
 * Gibt ein neues Objekt zurück (keine Mutation des Inputs).
 */
export function mergeServer(
  existing: CopilotMcpConfig | undefined,
  key: string,
  entry: CopilotMcpServer,
): CopilotMcpConfig {
  const base: CopilotMcpConfig = existing
    ? { ...existing, mcpServers: { ...(existing.mcpServers ?? {}) } }
    : { mcpServers: {} };
  base.mcpServers[key] = entry;
  return base;
}

/**
 * Entfernt einen Server-Eintrag aus der Config (reine Funktion).
 * Gibt ein neues Objekt zurück.
 */
export function removeServer(
  existing: CopilotMcpConfig | undefined,
  key: string,
): CopilotMcpConfig {
  if (!existing) return { mcpServers: {} };
  const servers = { ...(existing.mcpServers ?? {}) };
  delete servers[key];
  return { ...existing, mcpServers: servers };
}

/**
 * Liest und parst die Copilot-MCP-Config. Wirft bei korruptem JSON eine klare
 * Fehlermeldung, statt stillschweigend Daten zu verlieren.
 */
export function readCopilotConfig(path: string): CopilotMcpConfig | undefined {
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, "utf-8").trim();
  if (raw.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Copilot-MCP-Config ist kein gültiges JSON: ${path}. ` +
        `Bitte manuell prüfen/reparieren, bevor 'aios copilot install' erneut läuft.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Copilot-MCP-Config hat ein unerwartetes Format: ${path}`);
  }
  const cfg = parsed as CopilotMcpConfig;
  if (typeof cfg.mcpServers !== "object" || cfg.mcpServers === null) {
    cfg.mcpServers = {};
  }
  return cfg;
}

/** Schreibt die Config (pretty-printed, mit Trailing-Newline). */
function writeCopilotConfig(path: string, config: CopilotMcpConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ─── CLI-Aktionen ──────────────────────────────────────────

export async function runCopilotInstall(
  opts: CopilotInstallOptions = {},
): Promise<void> {
  const path = copilotConfigPath();
  const entry = buildAiosServerEntry(opts);

  if (opts.print) {
    const existing = readCopilotConfig(path);
    const merged = mergeServer(existing, AIOS_SERVER_KEY, entry);
    // Ergebnis-JSON auf stdout (Unix-Konvention), Hinweise auf stderr.
    console.error(chalk.gray(`# Würde geschrieben nach: ${path}`));
    console.log(JSON.stringify(merged, null, 2));
    return;
  }

  const existing = readCopilotConfig(path);
  const merged = mergeServer(existing, AIOS_SERVER_KEY, entry);
  writeCopilotConfig(path, merged);

  console.error(chalk.green("✓ AIOS in GitHub Copilot CLI registriert"));
  console.error(chalk.gray(`  Datei:    ${path}`));
  console.error(
    chalk.gray(`  Kommando: ${entry.command} ${entry.args.join(" ")}`),
  );
  console.error("");
  console.error("  Starte Copilot CLI neu und nutze die AIOS-Tools:");
  console.error(
    chalk.cyan("    aios_run, aios_orchestrate, aios_patterns, aios_plan"),
  );
}

export async function runCopilotUninstall(): Promise<void> {
  const path = copilotConfigPath();
  const existing = readCopilotConfig(path);

  if (!existing || !existing.mcpServers[AIOS_SERVER_KEY]) {
    console.error(chalk.yellow("AIOS war nicht in Copilot CLI registriert."));
    return;
  }

  const next = removeServer(existing, AIOS_SERVER_KEY);
  writeCopilotConfig(path, next);
  console.error(chalk.green("✓ AIOS aus GitHub Copilot CLI entfernt"));
  console.error(chalk.gray(`  Datei: ${path}`));
}
