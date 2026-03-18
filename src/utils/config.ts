import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as parseYaml } from "yaml";
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
    allowed: ["mmdc", "render-image", "prettier", "eslint", "ruff", "black"],
  },
  mcp: { servers: {} },
};

export function loadConfig(): AiosConfig {
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

function mergeConfig(partial: Partial<AiosConfig>): AiosConfig {
  return {
    providers: { ...DEFAULT_CONFIG.providers, ...partial.providers },
    defaults: { ...DEFAULT_CONFIG.defaults, ...partial.defaults },
    paths: { ...DEFAULT_CONFIG.paths, ...partial.paths },
    tools: { ...DEFAULT_CONFIG.tools, ...partial.tools },
    mcp: partial.mcp
      ? { servers: { ...DEFAULT_CONFIG.mcp!.servers, ...partial.mcp.servers } }
      : DEFAULT_CONFIG.mcp,
    rag: partial.rag,
  };
}

export function getAiosHome(): string {
  return AIOS_HOME;
}
