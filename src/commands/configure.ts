import { createInterface, type Interface } from "readline";
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import chalk from "chalk";
import ora from "ora";
import { saveConfig, saveEnv, getAiosHome } from "../utils/config.js";
import type { AiosConfig, ProviderConfig } from "../types.js";

// ─── Prompt Helpers ────────────────────────────────────────

function createRL(): Interface {
  return createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(rl: Interface, prompt: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` [${defaultVal}]` : "";
  return new Promise((resolve) => {
    rl.question(`  ${prompt}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

async function askYN(rl: Interface, prompt: string, defaultYes: boolean): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  return new Promise((resolve) => {
    rl.question(`  ${prompt} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes" || a === "j" || a === "ja");
    });
  });
}

async function askSecret(rl: Interface, prompt: string): Promise<string> {
  // Pragmatic v1: read normally with note about security
  return new Promise((resolve) => {
    rl.question(`  ${prompt}: `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function askChoice(rl: Interface, options: string[], defaultIdx: number = 0): Promise<number> {
  for (let i = 0; i < options.length; i++) {
    console.log(`    ${i + 1}) ${options[i]}`);
  }
  const answer = await ask(rl, `Wahl`, String(defaultIdx + 1));
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < options.length) return idx;
  return defaultIdx;
}

// ─── Ollama Helpers ────────────────────────────────────────

interface OllamaModel {
  name: string;
  size: number;
}

async function fetchOllamaModels(endpoint: string): Promise<OllamaModel[]> {
  const url = `${endpoint.replace(/\/$/, "")}/api/tags`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { models?: OllamaModel[] };
  return data.models ?? [];
}

// ─── Shell RC Helper ───────────────────────────────────────

function updateShellRC(): void {
  const marker = '[ -f "$HOME/.aios/.env" ] && set -a && source "$HOME/.aios/.env" && set +a';
  const shell = process.env.SHELL ?? "";
  const rcFile = shell.includes("zsh")
    ? join(homedir(), ".zshrc")
    : join(homedir(), ".bashrc");

  if (existsSync(rcFile)) {
    const content = readFileSync(rcFile, "utf-8");
    if (content.includes(".aios/.env")) return; // already present
  }

  appendFileSync(rcFile, `\n# AIOS\n${marker}\n`, "utf-8");
  console.log(chalk.gray(`  .env-Laden in ${rcFile} eingetragen`));
}

// ─── Main Wizard ───────────────────────────────────────────

export async function runConfigure(): Promise<void> {
  const rl = createRL();
  const aiosHome = getAiosHome();

  // Ensure ~/.aios exists
  mkdirSync(aiosHome, { recursive: true });

  console.log();
  console.log(chalk.bold("═══════════════════════════════════════"));
  console.log(chalk.bold("  AIOS Configuration"));
  console.log(chalk.bold("═══════════════════════════════════════"));
  console.log();

  const providers: Record<string, ProviderConfig> = {};
  const envVars: Record<string, string> = {};
  let defaultProvider = "claude";

  // ─── Anthropic (Claude) ────────────────────────────────

  console.log(chalk.cyan("▸ Anthropic (Claude)"));
  const setupAnthropic = await askYN(rl, "API Key einrichten?", true);

  if (setupAnthropic) {
    const apiKey = await askSecret(rl, "API Key (sk-ant-...)");
    if (apiKey) {
      envVars["ANTHROPIC_API_KEY"] = apiKey;
    }

    console.log("  Modell wählen:");
    const models = [
      "claude-sonnet-4-20250514  (empfohlen)",
      "claude-opus-4-20250514    (stärkstes Modell)",
      "claude-haiku-4-5-20251001 (schnellstes)",
    ];
    const modelIdx = await askChoice(rl, models, 0);
    const modelMap = [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-4-5-20251001",
    ];

    providers["claude"] = {
      type: "anthropic",
      model: modelMap[modelIdx],
    };

    console.log(chalk.green("  ✓ Anthropic konfiguriert"));
  }
  console.log();

  // ─── Ollama ────────────────────────────────────────────

  console.log(chalk.cyan("▸ Ollama (lokale Modelle)"));
  const setupOllama = await askYN(rl, "Ollama-Server einrichten?", false);

  if (setupOllama) {
    const endpoint = await ask(rl, "Endpoint", "http://localhost:11434");

    const spinner = ora({ text: "Teste Verbindung...", indent: 2 }).start();
    let models: OllamaModel[] = [];
    try {
      models = await fetchOllamaModels(endpoint);
      spinner.succeed("Ollama erreichbar");
    } catch (err) {
      spinner.fail(`Ollama nicht erreichbar: ${err instanceof Error ? err.message : err}`);
      console.log(chalk.yellow("  ⚠ Ollama wird übersprungen"));
      console.log();
    }

    if (models.length > 0) {
      console.log("  Verfügbare Modelle:");
      const modelNames = models.map((m) => m.name);
      const displayModels = modelNames.slice(0, 10); // limit display
      const mainIdx = await askChoice(rl, displayModels, 0);

      providers["ollama-fast"] = {
        type: "ollama",
        model: displayModels[mainIdx],
        endpoint,
      };

      const setupCodeModel = await askYN(rl, "Separates Code-Modell?", false);
      if (setupCodeModel) {
        const codeIdx = await askChoice(rl, displayModels, Math.min(1, displayModels.length - 1));
        providers["ollama-code"] = {
          type: "ollama",
          model: displayModels[codeIdx],
          endpoint,
        };
      }

      console.log(chalk.green("  ✓ Ollama konfiguriert"));
    }
  }
  console.log();

  // ─── Default Provider ──────────────────────────────────

  const providerNames = Object.keys(providers);
  if (providerNames.length > 1) {
    console.log(chalk.cyan("▸ Default Provider"));
    const descriptions = providerNames.map((name) => {
      const p = providers[name];
      return `${name.padEnd(15)} (${p.type === "anthropic" ? "Anthropic API" : "Lokal"})`;
    });
    const defIdx = await askChoice(rl, descriptions, 0);
    defaultProvider = providerNames[defIdx];
    console.log();
  } else if (providerNames.length === 1) {
    defaultProvider = providerNames[0];
  }

  // ─── Build config and save ─────────────────────────────

  const config: AiosConfig = {
    providers,
    defaults: { provider: defaultProvider },
    paths: {
      patterns: join("~/.aios", "patterns"),
      personas: join("~/.aios", "personas"),
    },
    tools: {
      output_dir: "./output",
      allowed: ["mmdc", "render-image", "prettier", "eslint", "ruff", "black"],
    },
  };

  const configPath = saveConfig(config);
  console.log(chalk.cyan(`▸ Konfiguration gespeichert: ${configPath}`));

  if (Object.keys(envVars).length > 0) {
    const envPath = saveEnv(envVars);
    console.log(chalk.cyan(`▸ API Keys gespeichert: ${envPath}`));
  }

  // Update shell RC for .env loading
  updateShellRC();

  console.log();
  console.log(chalk.green("  Fertig! Teste mit:"));
  console.log(chalk.white('    echo "Hello World" | aios run summarize'));
  console.log();

  rl.close();
}
