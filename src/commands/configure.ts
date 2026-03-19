import { createInterface, type Interface } from "readline";
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import chalk from "chalk";
import ora from "ora";
import { saveConfig, saveEnv, loadConfig, getAiosHome } from "../utils/config.js";
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

// ─── Status Display ────────────────────────────────────────

function getConfigStatus(): { config: AiosConfig; hasApiKey: boolean; hasGeminiKey: boolean } {
  const aiosHome = getAiosHome();
  const envPath = join(aiosHome, ".env");

  let config: AiosConfig;
  try {
    config = loadConfig();
  } catch {
    config = {
      providers: {},
      defaults: { provider: "claude" },
      paths: { patterns: join("~/.aios", "patterns"), personas: join("~/.aios", "personas") },
      tools: { output_dir: "./output", allowed: [] },
    };
  }

  let hasApiKey = false;
  let hasGeminiKey = false;
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    hasApiKey = envContent.includes("ANTHROPIC_API_KEY=");
    hasGeminiKey = envContent.includes("GEMINI_API_KEY=");
  }
  if (process.env.ANTHROPIC_API_KEY) hasApiKey = true;
  if (process.env.GEMINI_API_KEY) hasGeminiKey = true;

  return { config, hasApiKey, hasGeminiKey };
}

function showStatus(config: AiosConfig, hasApiKey: boolean, hasGeminiKey: boolean): void {
  console.log(chalk.bold("  Aktuelle Konfiguration:"));
  console.log();

  // Anthropic status
  const claudeProvider = config.providers["claude"];
  if (claudeProvider) {
    const keyStatus = hasApiKey ? chalk.green("✓ gesetzt") : chalk.red("✗ fehlt");
    console.log(`  Anthropic (Claude):  ${chalk.white(claudeProvider.model)}  │  API Key: ${keyStatus}`);
  } else {
    console.log(`  Anthropic (Claude):  ${chalk.gray("nicht konfiguriert")}`);
  }

  // Gemini status
  const geminiProvider = config.providers["gemini"];
  if (geminiProvider) {
    const keyStatus = hasGeminiKey ? chalk.green("✓ gesetzt") : chalk.red("✗ fehlt");
    console.log(`  Google (Gemini):     ${chalk.white(geminiProvider.model)}  │  API Key: ${keyStatus}`);
  } else {
    console.log(`  Google (Gemini):     ${chalk.gray("nicht konfiguriert")}`);
  }

  // Ollama status
  const ollamaProvider = config.providers["ollama-fast"];
  if (ollamaProvider) {
    console.log(`  Ollama:              ${chalk.white(ollamaProvider.model)}  │  ${ollamaProvider.endpoint}`);
    const ollamaCode = config.providers["ollama-code"];
    if (ollamaCode) {
      console.log(`  Ollama (Code):       ${chalk.white(ollamaCode.model)}`);
    }
  } else {
    console.log(`  Ollama:              ${chalk.gray("nicht konfiguriert")}`);
  }

  // Default provider
  console.log(`  Default Provider:    ${chalk.white(config.defaults.provider)}`);
  console.log();
}

// ─── Section: Anthropic ────────────────────────────────────

async function configureAnthropic(
  rl: Interface,
  providers: Record<string, ProviderConfig>,
  envVars: Record<string, string>,
  existing?: ProviderConfig,
): Promise<Interface> {
  console.log();
  console.log(chalk.cyan("▸ Anthropic (Claude)"));

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

  // Pre-select current model if reconfiguring
  let defaultModelIdx = 0;
  if (existing) {
    const modelMap = [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-4-5-20251001",
    ];
    const currentIdx = modelMap.indexOf(existing.model);
    if (currentIdx >= 0) defaultModelIdx = currentIdx;
  }

  const modelIdx = await askChoice(rl, models, defaultModelIdx);
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
  return rl;
}

// ─── Section: Gemini ──────────────────────────────────────

async function configureGemini(
  rl: Interface,
  providers: Record<string, ProviderConfig>,
  envVars: Record<string, string>,
  existing?: ProviderConfig,
): Promise<Interface> {
  console.log();
  console.log(chalk.cyan("▸ Google (Gemini)"));

  const apiKey = await askSecret(rl, "API Key (AIza...)");
  if (apiKey) {
    envVars["GEMINI_API_KEY"] = apiKey;
  }

  console.log("  Modell wählen:");
  const models = [
    "gemini-2.0-flash       (empfohlen, schnell)",
    "gemini-2.5-pro         (stärkstes Modell)",
    "gemini-2.5-flash       (schnell + günstig)",
  ];

  let defaultModelIdx = 0;
  if (existing) {
    const modelMap = [
      "gemini-2.0-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ];
    const currentIdx = modelMap.indexOf(existing.model);
    if (currentIdx >= 0) defaultModelIdx = currentIdx;
  }

  const modelIdx = await askChoice(rl, models, defaultModelIdx);
  const modelMap = [
    "gemini-2.0-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
  ];

  providers["gemini"] = {
    type: "gemini",
    model: modelMap[modelIdx],
  };

  console.log(chalk.green("  ✓ Gemini konfiguriert"));
  return rl;
}

// ─── Section: Ollama ───────────────────────────────────────

async function configureOllama(
  rl: Interface,
  providers: Record<string, ProviderConfig>,
  existing?: ProviderConfig,
): Promise<Interface> {
  console.log();
  console.log(chalk.cyan("▸ Ollama (lokale Modelle)"));

  const defaultEndpoint = existing?.endpoint ?? "http://localhost:11434";
  const endpoint = await ask(rl, "Endpoint", defaultEndpoint);

  rl.close();
  const spinner = ora({ text: "Teste Verbindung...", indent: 2 }).start();
  let models: OllamaModel[] = [];
  try {
    models = await fetchOllamaModels(endpoint);
    spinner.succeed("Ollama erreichbar");
  } catch (err) {
    spinner.fail(`Ollama nicht erreichbar: ${err instanceof Error ? err.message : err}`);
    console.log(chalk.yellow("  ⚠ Ollama wird übersprungen"));
  }
  rl = createRL();

  if (models.length > 0) {
    console.log("  Verfügbare Modelle:");
    const modelNames = models.map((m) => m.name);
    const displayModels = modelNames.slice(0, 10);
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

  return rl;
}

// ─── Section: Default Provider ─────────────────────────────

async function configureDefaultProvider(
  rl: Interface,
  providers: Record<string, ProviderConfig>,
): Promise<string> {
  const providerNames = Object.keys(providers);
  if (providerNames.length === 0) {
    console.log(chalk.yellow("  ⚠ Keine Provider konfiguriert"));
    return "claude";
  }
  if (providerNames.length === 1) {
    console.log(`  Default Provider: ${chalk.white(providerNames[0])}`);
    return providerNames[0];
  }

  console.log();
  console.log(chalk.cyan("▸ Default Provider"));
  const descriptions = providerNames.map((name) => {
    const p = providers[name];
    const typeLabel = p.type === "anthropic" ? "Anthropic API" : p.type === "gemini" ? "Google API" : "Lokal";
    return `${name.padEnd(15)} (${typeLabel})`;
  });
  const defIdx = await askChoice(rl, descriptions, 0);
  return providerNames[defIdx];
}

// ─── Save & Finish ─────────────────────────────────────────

function saveAndFinish(
  providers: Record<string, ProviderConfig>,
  defaultProvider: string,
  envVars: Record<string, string>,
): void {
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
  console.log(chalk.cyan(`  ▸ Konfiguration gespeichert: ${configPath}`));

  if (Object.keys(envVars).length > 0) {
    const envPath = saveEnv(envVars);
    console.log(chalk.cyan(`  ▸ API Keys gespeichert: ${envPath}`));
  }

  updateShellRC();

  console.log();
  console.log(chalk.green("  Fertig! Teste mit:"));
  console.log(chalk.white('    echo "Hello World" | aios run summarize'));
  console.log();
}

// ─── Main Menu ─────────────────────────────────────────────

export async function runConfigure(): Promise<void> {
  let rl = createRL();
  const aiosHome = getAiosHome();

  // Ensure ~/.aios exists
  mkdirSync(aiosHome, { recursive: true });

  console.log();
  console.log(chalk.bold("═══════════════════════════════════════"));
  console.log(chalk.bold("  AIOS Configuration"));
  console.log(chalk.bold("═══════════════════════════════════════"));
  console.log();

  // Load existing config for status display
  const { config: existingConfig, hasApiKey, hasGeminiKey } = getConfigStatus();

  // Check if this is a fresh setup (no config file exists)
  const configExists = existsSync(join(aiosHome, "config.yaml"));

  if (!configExists) {
    // First-time setup: run full wizard
    console.log(chalk.gray("  Erste Einrichtung – alle Provider werden konfiguriert."));
    console.log();

    const providers: Record<string, ProviderConfig> = {};
    const envVars: Record<string, string> = {};

    // Anthropic
    console.log(chalk.cyan("▸ Anthropic (Claude)"));
    const setupAnthropic = await askYN(rl, "API Key einrichten?", true);
    if (setupAnthropic) {
      rl = await configureAnthropic(rl, providers, envVars);
    }
    console.log();

    // Gemini
    console.log(chalk.cyan("▸ Google (Gemini)"));
    const setupGemini = await askYN(rl, "API Key einrichten?", false);
    if (setupGemini) {
      rl = await configureGemini(rl, providers, envVars);
    }
    console.log();

    // Ollama
    console.log(chalk.cyan("▸ Ollama (lokale Modelle)"));
    const setupOllama = await askYN(rl, "Ollama-Server einrichten?", false);
    if (setupOllama) {
      rl = await configureOllama(rl, providers);
    }
    console.log();

    // Default provider
    const defaultProvider = await configureDefaultProvider(rl, providers);

    rl.close();
    saveAndFinish(providers, defaultProvider, envVars);
    return;
  }

  // Existing config: show menu
  showStatus(existingConfig, hasApiKey, hasGeminiKey);

  let running = true;
  while (running) {
    console.log(chalk.bold("  Was möchtest du konfigurieren?"));
    console.log();
    const menuOptions = [
      "Anthropic (Claude) – API Key & Modell",
      "Google (Gemini) – API Key & Modell",
      "Ollama – Lokale Modelle",
      "Default Provider wählen",
      "Alles neu konfigurieren",
      "Beenden",
    ];
    const choice = await askChoice(rl, menuOptions, 0);

    // Work with a copy of existing providers
    const providers: Record<string, ProviderConfig> = { ...existingConfig.providers };
    const envVars: Record<string, string> = {};

    switch (choice) {
      case 0: {
        // Anthropic
        rl = await configureAnthropic(rl, providers, envVars, existingConfig.providers["claude"]);
        const defaultProvider = await configureDefaultProvider(rl, providers);
        rl.close();
        saveAndFinish(providers, defaultProvider, envVars);
        running = false;
        break;
      }
      case 1: {
        // Gemini
        rl = await configureGemini(rl, providers, envVars, existingConfig.providers["gemini"]);
        const defaultProvider = await configureDefaultProvider(rl, providers);
        rl.close();
        saveAndFinish(providers, defaultProvider, envVars);
        running = false;
        break;
      }
      case 2: {
        // Ollama
        rl = await configureOllama(rl, providers, existingConfig.providers["ollama-fast"]);
        const defaultProvider = await configureDefaultProvider(rl, providers);
        rl.close();
        saveAndFinish(providers, defaultProvider, envVars);
        running = false;
        break;
      }
      case 3: {
        // Default provider only
        const defaultProvider = await configureDefaultProvider(rl, providers);
        rl.close();
        saveAndFinish(providers, defaultProvider, envVars);
        running = false;
        break;
      }
      case 4: {
        // Full reconfigure
        const freshProviders: Record<string, ProviderConfig> = {};

        console.log();
        console.log(chalk.cyan("▸ Anthropic (Claude)"));
        const setupAnthropic = await askYN(rl, "API Key einrichten?", true);
        if (setupAnthropic) {
          rl = await configureAnthropic(rl, freshProviders, envVars, existingConfig.providers["claude"]);
        }
        console.log();

        console.log(chalk.cyan("▸ Google (Gemini)"));
        const setupGemini = await askYN(rl, "API Key einrichten?", false);
        if (setupGemini) {
          rl = await configureGemini(rl, freshProviders, envVars, existingConfig.providers["gemini"]);
        }
        console.log();

        console.log(chalk.cyan("▸ Ollama (lokale Modelle)"));
        const setupOllama = await askYN(rl, "Ollama-Server einrichten?", false);
        if (setupOllama) {
          rl = await configureOllama(rl, freshProviders, existingConfig.providers["ollama-fast"]);
        }
        console.log();

        const defaultProvider = await configureDefaultProvider(rl, freshProviders);
        rl.close();
        saveAndFinish(freshProviders, defaultProvider, envVars);
        running = false;
        break;
      }
      case 5: {
        // Exit
        console.log();
        rl.close();
        running = false;
        break;
      }
    }
  }
}
