import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { AiosConfig } from "../types.js";

const AIOS_HOME = join(homedir(), ".aios");

const DEFAULT_CONFIG: AiosConfig = {
  providers: {
    claude: { type: "anthropic", model: "claude-sonnet-4-20250514" },
  },
  defaults: { provider: "claude" },
  paths: {
    patterns: join(AIOS_HOME, "patterns"),
    personas: join(AIOS_HOME, "personas"),
  },
  tools: {
    output_dir: "./output",
    allowed: ["mmdc", "render-image", "prettier", "eslint", "ruff", "black", "tsx"],
  },
  mcp: { servers: {} },
};

/** Parse ~/.aios/.env and set variables in process.env (without overwriting existing) */
export function loadEnv(): void {
  const envPath = join(AIOS_HOME, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/** Save AiosConfig as YAML to ~/.aios/config.yaml */
export function saveConfig(config: AiosConfig): string {
  const configPath = join(AIOS_HOME, "config.yaml");
  const header = "# AIOS Configuration\n# Bearbeiten: aios configure\n\n";
  const yamlContent = yamlStringify({
    providers: config.providers,
    defaults: config.defaults,
    paths: config.paths,
  });
  writeFileSync(configPath, header + yamlContent, "utf-8");
  return configPath;
}

/** Write key-value pairs to ~/.aios/.env. Updates existing keys, appends new ones. chmod 600. */
export function saveEnv(vars: Record<string, string>): string {
  const envPath = join(AIOS_HOME, ".env");
  const existing = new Map<string, string>();
  const lines: string[] = [];

  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        lines.push(line);
        continue;
      }
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) {
        lines.push(line);
        continue;
      }
      const key = trimmed.slice(0, eqIndex).trim();
      existing.set(key, line);
      // Will be replaced or kept
      if (key in vars) {
        lines.push(`${key}=${vars[key]}`);
      } else {
        lines.push(line);
      }
    }
  }

  // Append new keys not already in file
  for (const [key, value] of Object.entries(vars)) {
    if (!existing.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");
  chmodSync(envPath, 0o600);
  return envPath;
}

export function loadConfig(): AiosConfig {
  loadEnv();
  // 1. Projekt-lokale config (./aios.yaml)
  const localPath = join(process.cwd(), "aios.yaml");
  if (existsSync(localPath)) {
    return mergeConfig(parseYaml(readFileSync(localPath, "utf-8")));
  }

  // 2. Globale config (~/.aios/config.yaml)
  const globalPath = join(AIOS_HOME, "config.yaml");
  if (existsSync(globalPath)) {
    return mergeConfig(parseYaml(readFileSync(globalPath, "utf-8")));
  }

  // 3. Default + lokales patterns/ Verzeichnis falls vorhanden
  const localPatterns = join(process.cwd(), "patterns");
  if (existsSync(localPatterns)) {
    return { ...DEFAULT_CONFIG, paths: { ...DEFAULT_CONFIG.paths, patterns: localPatterns } };
  }

  return DEFAULT_CONFIG;
}

/** Recursively replace ${VAR} placeholders with process.env values */
function expandEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = expandEnvVars(v);
    }
    return result;
  }
  return obj;
}

function mergeConfig(partial: Partial<AiosConfig>): AiosConfig {
  const expanded = expandEnvVars(partial) as Partial<AiosConfig>;
  return {
    providers: { ...DEFAULT_CONFIG.providers, ...expanded.providers },
    defaults: { ...DEFAULT_CONFIG.defaults, ...expanded.defaults },
    paths: { ...DEFAULT_CONFIG.paths, ...expanded.paths },
    tools: { ...DEFAULT_CONFIG.tools, ...expanded.tools },
    mcp: expanded.mcp
      ? { servers: { ...DEFAULT_CONFIG.mcp!.servers, ...expanded.mcp.servers } }
      : DEFAULT_CONFIG.mcp,
    rag: expanded.rag,
    escalation: expanded.escalation,
    quality: expanded.quality,
  };
}

/** Read a single key's value from ~/.aios/.env (or process.env fallback) */
export function readEnvKey(key: string): string | undefined {
  const envPath = join(AIOS_HOME, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      if (trimmed.slice(0, eqIndex).trim() === key) {
        return trimmed.slice(eqIndex + 1).trim();
      }
    }
  }
  return process.env[key] || undefined;
}

/** Remove a key from ~/.aios/.env */
export function removeEnvKey(key: string): void {
  const envPath = join(AIOS_HOME, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return true;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) return true;
    return trimmed.slice(0, eqIndex).trim() !== key;
  });
  writeFileSync(envPath, filtered.join("\n") + "\n", "utf-8");
  chmodSync(envPath, 0o600);
}

export function getAiosHome(): string {
  return AIOS_HOME;
}
