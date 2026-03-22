import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { parse, stringify } from "yaml";
import type { ContextConfig } from "../types.js";

// ─── Re-export for backward compatibility ────────────────
export type { ContextConfig } from "../types.js";

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
      config: {
        schema_version: "1.0",
        name: "default",
        description: "Default context",
        type: "project",
        capabilities: [],
        exports: [],
        accepts: [],
        links: [],
        config: {
          default_provider: "claude",
          patterns_dir: "./patterns",
          personas_dir: "./personas",
          knowledge_dir: "./knowledge",
        },
      },
    };
  }

  /**
   * Initialize a new context.
   * @param name Context name (kebab-case)
   * @param local If true, creates .aios/ in CWD instead of ~/.aios/contexts/
   */
  init(name: string, local: boolean = false, cwd: string = process.cwd(), opts?: { type?: ContextConfig["type"]; description?: string }): string {
    const contextDir = local ? join(cwd, ".aios") : join(CONTEXTS_DIR, name);

    if (existsSync(join(contextDir, "context.yaml"))) {
      throw new Error(`Context "${name}" existiert bereits: ${contextDir}`);
    }

    mkdirSync(contextDir, { recursive: true });
    mkdirSync(join(contextDir, "patterns"), { recursive: true });
    mkdirSync(join(contextDir, "personas"), { recursive: true });
    mkdirSync(join(contextDir, "knowledge"), { recursive: true });

    const config: ContextConfig = {
      schema_version: "1.0",
      name,
      description: opts?.description ?? `Context ${name}`,
      type: opts?.type ?? "project",
      capabilities: [],
      exports: [],
      accepts: [],
      links: [],
      config: {
        default_provider: "claude",
        patterns_dir: "./patterns",
        personas_dir: "./personas",
        knowledge_dir: "./knowledge",
      },
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
      stringify(config, { lineWidth: 120 }),
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
      throw new Error(`Context "${name}" existiert nicht. Erstelle ihn mit: aios init`);
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
      const parsed = parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || !parsed.name) return null;

      // Normalize: ensure unified format fields exist with defaults
      const config: ContextConfig = {
        schema_version: (parsed.schema_version as string) ?? "1.0",
        name: parsed.name as string,
        description: (parsed.description as string) ?? "",
        type: (parsed.type as ContextConfig["type"]) ?? "project",
        capabilities: (parsed.capabilities as ContextConfig["capabilities"]) ?? [],
        exports: (parsed.exports as ContextConfig["exports"]) ?? [],
        accepts: (parsed.accepts as ContextConfig["accepts"]) ?? [],
        links: (parsed.links as ContextConfig["links"]) ?? [],
        config: (parsed.config as ContextConfig["config"]) ?? {
          default_provider: "claude",
          patterns_dir: "./patterns",
          personas_dir: "./personas",
          knowledge_dir: "./knowledge",
        },
        // Optional fields — only set if present
        ...(parsed.project ? { project: parsed.project as ContextConfig["project"] } : {}),
        ...(parsed.aios ? { aios: parsed.aios as ContextConfig["aios"] } : {}),
        ...(parsed.compliance ? { compliance: parsed.compliance as ContextConfig["compliance"] } : {}),
        ...(parsed.personas ? { personas: parsed.personas as ContextConfig["personas"] } : {}),
        ...(parsed.providers ? { providers: parsed.providers as ContextConfig["providers"] } : {}),
        ...(parsed.knowledge ? { knowledge: parsed.knowledge as ContextConfig["knowledge"] } : {}),
        ...(parsed.permissions ? { permissions: parsed.permissions as ContextConfig["permissions"] } : {}),
        ...(parsed.required_traits ? { required_traits: parsed.required_traits as string[] } : {}),
      };

      return config;
    } catch {
      return null;
    }
  }
}
