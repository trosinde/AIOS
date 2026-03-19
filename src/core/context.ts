import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { parse, stringify } from "yaml";

// ─── Types ──────────────────────────────────────────────

export interface ContextConfig {
  name: string;
  version: number;
  description?: string;
  domain?: string;
  required_traits?: string[];
  provider_defaults?: {
    preferred?: string;
    fallback?: string;
  };
  knowledge?: {
    backend?: "sqlite";
    isolation?: "strict" | "relaxed";
    retention_days?: number;
  };
  permissions?: {
    allow_ipc?: boolean;
    allow_tool_execution?: boolean;
    allowed_tools?: string[];
  };
}

export interface ContextInfo {
  name: string;
  path: string;
  source: "project" | "global";
  config: ContextConfig;
}

// ─── Paths ──────────────────────────────────────────────

const AIOS_HOME = join(homedir(), ".aios");
const KERNEL_DIR = join(AIOS_HOME, "kernel");
const CONTEXTS_DIR = join(AIOS_HOME, "contexts");
const ACTIVE_CONTEXT_FILE = join(AIOS_HOME, "active_context");

export function getAiosHome(): string { return AIOS_HOME; }
export function getKernelDir(): string { return KERNEL_DIR; }
export function getContextsDir(): string { return CONTEXTS_DIR; }

// ─── Context Manager ────────────────────────────────────

export class ContextManager {
  /**
   * Resolve the active context.
   * Priority: 1) .aios/ in CWD → 2) ~/.aios/active_context → 3) "default"
   */
  resolveActive(cwd: string = process.cwd()): ContextInfo {
    // 1. Check project-local .aios/context.yaml
    const localContextPath = join(cwd, ".aios", "context.yaml");
    if (existsSync(localContextPath)) {
      const config = this.loadContextYaml(localContextPath);
      if (config) {
        return {
          name: config.name,
          path: join(cwd, ".aios"),
          source: "project",
          config,
        };
      }
    }

    // 2. Check ~/.aios/active_context
    if (existsSync(ACTIVE_CONTEXT_FILE)) {
      const activeName = readFileSync(ACTIVE_CONTEXT_FILE, "utf-8").trim();
      if (activeName) {
        const globalPath = join(CONTEXTS_DIR, activeName);
        const globalConfigPath = join(globalPath, "context.yaml");
        if (existsSync(globalConfigPath)) {
          const config = this.loadContextYaml(globalConfigPath);
          if (config) {
            return {
              name: config.name,
              path: globalPath,
              source: "global",
              config,
            };
          }
        }
      }
    }

    // 3. Default context
    return {
      name: "default",
      path: AIOS_HOME,
      source: "global",
      config: { name: "default", version: 1, description: "Default context" },
    };
  }

  /**
   * Initialize a new context.
   * @param name Context name (kebab-case)
   * @param local If true, creates .aios/ in CWD instead of ~/.aios/contexts/
   */
  init(name: string, local: boolean = false, cwd: string = process.cwd()): string {
    const contextDir = local ? join(cwd, ".aios") : join(CONTEXTS_DIR, name);

    if (existsSync(join(contextDir, "context.yaml"))) {
      throw new Error(`Context "${name}" existiert bereits: ${contextDir}`);
    }

    mkdirSync(contextDir, { recursive: true });
    mkdirSync(join(contextDir, "patterns"), { recursive: true });
    mkdirSync(join(contextDir, "personas"), { recursive: true });
    mkdirSync(join(contextDir, "knowledge"), { recursive: true });

    const config: ContextConfig = {
      name,
      version: 1,
      description: `Context ${name}`,
      knowledge: {
        backend: "sqlite",
        isolation: "strict",
        retention_days: 0,
      },
      permissions: {
        allow_ipc: true,
        allow_tool_execution: true,
        allowed_tools: [],
      },
    };

    writeFileSync(
      join(contextDir, "context.yaml"),
      stringify(config),
      "utf-8"
    );

    return contextDir;
  }

  /**
   * Switch active global context.
   */
  switch(name: string): void {
    const contextDir = join(CONTEXTS_DIR, name);
    if (!existsSync(join(contextDir, "context.yaml"))) {
      throw new Error(`Context "${name}" existiert nicht. Erstelle ihn mit: aios context init ${name}`);
    }
    mkdirSync(AIOS_HOME, { recursive: true });
    writeFileSync(ACTIVE_CONTEXT_FILE, name, "utf-8");
  }

  /**
   * List all available contexts (global + project-local).
   */
  list(cwd: string = process.cwd()): ContextInfo[] {
    const contexts: ContextInfo[] = [];

    // Global contexts
    if (existsSync(CONTEXTS_DIR)) {
      for (const entry of readdirSync(CONTEXTS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const configPath = join(CONTEXTS_DIR, entry.name, "context.yaml");
        if (existsSync(configPath)) {
          const config = this.loadContextYaml(configPath);
          if (config) {
            contexts.push({
              name: config.name,
              path: join(CONTEXTS_DIR, entry.name),
              source: "global",
              config,
            });
          }
        }
      }
    }

    // Project-local context
    const localConfigPath = join(cwd, ".aios", "context.yaml");
    if (existsSync(localConfigPath)) {
      const config = this.loadContextYaml(localConfigPath);
      if (config) {
        contexts.push({
          name: config.name,
          path: join(cwd, ".aios"),
          source: "project",
          config,
        });
      }
    }

    return contexts;
  }

  /**
   * Ensure ~/.aios/kernel/ directory structure exists.
   */
  ensureKernelDirs(): void {
    mkdirSync(join(KERNEL_DIR, "patterns"), { recursive: true });
    mkdirSync(join(KERNEL_DIR, "personas"), { recursive: true });
  }

  /**
   * Build the pattern lookup order for the active context.
   * Returns directories in priority order (highest first).
   */
  patternDirs(activeContext: ContextInfo, repoPatternsDir: string): string[] {
    const dirs: string[] = [];

    // 1. Project-local patterns (highest priority)
    if (activeContext.source === "project") {
      const localPatterns = join(activeContext.path, "patterns");
      if (existsSync(localPatterns)) dirs.push(localPatterns);
    }

    // 2. Context-specific patterns
    if (activeContext.source === "global" && activeContext.name !== "default") {
      const contextPatterns = join(activeContext.path, "patterns");
      if (existsSync(contextPatterns)) dirs.push(contextPatterns);
    }

    // 3. Repository patterns
    if (existsSync(repoPatternsDir)) dirs.push(repoPatternsDir);

    // 4. Kernel patterns (lowest priority)
    const kernelPatterns = join(KERNEL_DIR, "patterns");
    if (existsSync(kernelPatterns)) dirs.push(kernelPatterns);

    return dirs;
  }

  // ─── Helpers ──────────────────────────────────────────

  private loadContextYaml(path: string): ContextConfig | null {
    try {
      const raw = readFileSync(path, "utf-8");
      const config = parse(raw) as ContextConfig;
      return config?.name ? config : null;
    } catch {
      return null;
    }
  }
}
