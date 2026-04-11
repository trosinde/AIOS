import { createInterface, type Interface } from "readline";
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import chalk from "chalk";
import ora from "ora";
import { saveConfig, saveEnv, loadConfig, getAiosHome, readEnvKey, removeEnvKey } from "../utils/config.js";
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

// ─── Key Masking ──────────────────────────────────────────

function maskKey(key: string | undefined): string {
  if (!key) return chalk.red("✗ fehlt");
  if (key.length <= 11) return chalk.green("✓ gesetzt");
  return chalk.green(`✓ ${key.slice(0, 8)}...${key.slice(-3)}`);
}

// ─── Status Display ────────────────────────────────────────

function showStatus(
  providers: Record<string, ProviderConfig>,
  defaultProvider: string,
  anthropicKey: string | undefined,
  geminiKey: string | undefined,
): void {
  console.log(chalk.bold("  Aktuelle Konfiguration:"));
  console.log();

  // Anthropic status
  const claudeProvider = providers["claude"];
  if (claudeProvider) {
    console.log(`  Anthropic (Claude):  ${chalk.white(claudeProvider.model)}  │  API Key: ${maskKey(anthropicKey)}`);
  } else {
    console.log(`  Anthropic (Claude):  ${chalk.gray("nicht konfiguriert")}`);
  }

  // Gemini status
  const geminiProvider = providers["gemini"];
  if (geminiProvider) {
    console.log(`  Google (Gemini):     ${chalk.white(geminiProvider.model)}  │  API Key: ${maskKey(geminiKey)}`);
  } else {
    console.log(`  Google (Gemini):     ${chalk.gray("nicht konfiguriert")}`);
  }

  // Ollama status
  const ollamaProvider = providers["ollama-fast"];
  if (ollamaProvider) {
    console.log(`  Ollama:              ${chalk.white(ollamaProvider.model)}  │  ${ollamaProvider.endpoint}`);
    const ollamaCode = providers["ollama-code"];
    if (ollamaCode) {
      console.log(`  Ollama (Code):       ${chalk.white(ollamaCode.model)}`);
    }
  } else {
    console.log(`  Ollama:              ${chalk.gray("nicht konfiguriert")}`);
  }

  // Default provider
  console.log(`  Default Provider:    ${chalk.white(defaultProvider)}`);
  console.log();
}

// ─── Section: Anthropic ────────────────────────────────────

async function configureAnthropic(
  rl: Interface,
  providers: Record<string, ProviderConfig>,
  envVars: Record<string, string>,
  existing?: ProviderConfig,
  existingKey?: string,
): Promise<Interface> {
  console.log();
  console.log(chalk.cyan("▸ Anthropic (Claude)"));

  if (existingKey) {
    console.log(`  Aktueller API Key: ${maskKey(existingKey)}`);
    const changeKey = await askYN(rl, "API Key ändern?", false);
    if (changeKey) {
      const apiKey = await askSecret(rl, "Neuer API Key (sk-ant-...)");
      if (apiKey) envVars["ANTHROPIC_API_KEY"] = apiKey;
    }
  } else {
    const apiKey = await askSecret(rl, "API Key (sk-ant-...)");
    if (apiKey) {
      envVars["ANTHROPIC_API_KEY"] = apiKey;
    }
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
  existingKey?: string,
): Promise<Interface> {
  console.log();
  console.log(chalk.cyan("▸ Google (Gemini)"));

  if (existingKey) {
    console.log(`  Aktueller API Key: ${maskKey(existingKey)}`);
    const changeKey = await askYN(rl, "API Key ändern?", false);
    if (changeKey) {
      const apiKey = await askSecret(rl, "Neuer API Key (AIza...)");
      if (apiKey) envVars["GEMINI_API_KEY"] = apiKey;
    }
  } else {
    const apiKey = await askSecret(rl, "API Key (AIza...)");
    if (apiKey) {
      envVars["GEMINI_API_KEY"] = apiKey;
    }
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
  currentDefault?: string,
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
  const currentIdx = currentDefault ? Math.max(0, providerNames.indexOf(currentDefault)) : 0;
  const defIdx = await askChoice(rl, descriptions, currentIdx);
  return providerNames[defIdx];
}

// ─── Save & Finish ─────────────────────────────────────────

function saveAndFinish(
  providers: Record<string, ProviderConfig>,
  defaultProvider: string,
  envVars: Record<string, string>,
  envKeysToRemove: string[],
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
      allowed: ["mmdc", "render-image", "prettier", "eslint", "ruff", "black", "tsx"],
    },
  };

  const configPath = saveConfig(config);
  console.log(chalk.cyan(`  ▸ Konfiguration gespeichert: ${configPath}`));

  if (Object.keys(envVars).length > 0) {
    const envPath = saveEnv(envVars);
    console.log(chalk.cyan(`  ▸ API Keys gespeichert: ${envPath}`));
  }

  for (const key of envKeysToRemove) {
    removeEnvKey(key);
  }
  if (envKeysToRemove.length > 0) {
    console.log(chalk.cyan(`  ▸ Entfernte Keys: ${envKeysToRemove.join(", ")}`));
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

  // Load existing config
  let existingConfig: AiosConfig;
  try {
    existingConfig = loadConfig();
  } catch {
    existingConfig = {
      providers: {},
      defaults: { provider: "claude" },
      paths: { patterns: join("~/.aios", "patterns"), personas: join("~/.aios", "personas") },
      tools: { output_dir: "./output", allowed: [] },
    };
  }

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
    saveAndFinish(providers, defaultProvider, envVars, []);
    return;
  }

  // ─── Persistent Menu Loop (existing config) ─────────────

  // Mutable working copies
  const providers: Record<string, ProviderConfig> = { ...existingConfig.providers };
  const envVars: Record<string, string> = {};
  const envKeysToRemove: string[] = [];
  let defaultProvider = existingConfig.defaults.provider;
  let dirty = false;

  // Track current key values (may be updated by user during session)
  let anthropicKey = readEnvKey("ANTHROPIC_API_KEY");
  let geminiKey = readEnvKey("GEMINI_API_KEY");

  let running = true;
  while (running) {
    // Show current status
    const effectiveAnthropicKey = envKeysToRemove.includes("ANTHROPIC_API_KEY")
      ? undefined
      : (envVars["ANTHROPIC_API_KEY"] || anthropicKey);
    const effectiveGeminiKey = envKeysToRemove.includes("GEMINI_API_KEY")
      ? undefined
      : (envVars["GEMINI_API_KEY"] || geminiKey);

    showStatus(providers, defaultProvider, effectiveAnthropicKey, effectiveGeminiKey);

    // Build dynamic menu
    type MenuItem = { label: string; action: () => Promise<void> };
    const menuItems: MenuItem[] = [];

    // Anthropic options
    if (providers["claude"]) {
      menuItems.push({
        label: "Anthropic (Claude) ändern",
        action: async () => {
          rl = await configureAnthropic(rl, providers, envVars, providers["claude"], effectiveAnthropicKey);
          if (envVars["ANTHROPIC_API_KEY"]) anthropicKey = envVars["ANTHROPIC_API_KEY"];
          dirty = true;
        },
      });
      menuItems.push({
        label: "Anthropic (Claude) entfernen",
        action: async () => {
          delete providers["claude"];
          envKeysToRemove.push("ANTHROPIC_API_KEY");
          if (defaultProvider === "claude") {
            const keys = Object.keys(providers);
            defaultProvider = keys[0] || "";
          }
          dirty = true;
          console.log(chalk.yellow("  ✓ Anthropic entfernt"));
        },
      });
    } else {
      menuItems.push({
        label: "Anthropic (Claude) einrichten",
        action: async () => {
          rl = await configureAnthropic(rl, providers, envVars);
          if (envVars["ANTHROPIC_API_KEY"]) anthropicKey = envVars["ANTHROPIC_API_KEY"];
          dirty = true;
        },
      });
    }

    // Gemini options
    if (providers["gemini"]) {
      menuItems.push({
        label: "Google (Gemini) ändern",
        action: async () => {
          rl = await configureGemini(rl, providers, envVars, providers["gemini"], effectiveGeminiKey);
          if (envVars["GEMINI_API_KEY"]) geminiKey = envVars["GEMINI_API_KEY"];
          dirty = true;
        },
      });
      menuItems.push({
        label: "Google (Gemini) entfernen",
        action: async () => {
          delete providers["gemini"];
          envKeysToRemove.push("GEMINI_API_KEY");
          if (defaultProvider === "gemini") {
            const keys = Object.keys(providers);
            defaultProvider = keys[0] || "";
          }
          dirty = true;
          console.log(chalk.yellow("  ✓ Gemini entfernt"));
        },
      });
    } else {
      menuItems.push({
        label: "Google (Gemini) einrichten",
        action: async () => {
          rl = await configureGemini(rl, providers, envVars);
          if (envVars["GEMINI_API_KEY"]) geminiKey = envVars["GEMINI_API_KEY"];
          dirty = true;
        },
      });
    }

    // Ollama options
    if (providers["ollama-fast"]) {
      menuItems.push({
        label: "Ollama ändern",
        action: async () => {
          rl = await configureOllama(rl, providers, providers["ollama-fast"]);
          dirty = true;
        },
      });
      menuItems.push({
        label: "Ollama entfernen",
        action: async () => {
          delete providers["ollama-fast"];
          delete providers["ollama-code"];
          if (defaultProvider === "ollama-fast" || defaultProvider === "ollama-code") {
            const keys = Object.keys(providers);
            defaultProvider = keys[0] || "";
          }
          dirty = true;
          console.log(chalk.yellow("  ✓ Ollama entfernt"));
        },
      });
    } else {
      menuItems.push({
        label: "Ollama einrichten",
        action: async () => {
          rl = await configureOllama(rl, providers);
          dirty = true;
        },
      });
    }

    // Default provider (only if >1 provider)
    if (Object.keys(providers).filter((k) => k !== "ollama-code").length > 1) {
      menuItems.push({
        label: "Default Provider ändern",
        action: async () => {
          defaultProvider = await configureDefaultProvider(rl, providers, defaultProvider);
          dirty = true;
        },
      });
    }

    // Exit options
    if (dirty) {
      menuItems.push({
        label: chalk.green("Speichern & Beenden"),
        action: async () => {
          rl.close();
          saveAndFinish(providers, defaultProvider, envVars, envKeysToRemove);
          running = false;
        },
      });
      menuItems.push({
        label: "Verwerfen & Beenden",
        action: async () => {
          console.log(chalk.yellow("  Änderungen verworfen."));
          rl.close();
          running = false;
        },
      });
    } else {
      menuItems.push({
        label: "Beenden",
        action: async () => {
          rl.close();
          running = false;
        },
      });
    }

    // Display menu
    console.log(chalk.bold("  Was möchtest du tun?"));
    console.log();
    const labels = menuItems.map((m) => m.label);
    const choice = await askChoice(rl, labels, 0);
    await menuItems[choice].action();
    console.log();
  }
}
