import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { stringify } from "yaml";
import type { ContextConfig } from "../types.js";
import { parseContextYaml } from "../init/schema.js";

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

  /**
   * Rename a context (updates context.yaml, directory, active_context, registry).
   * Works for both project-local and global contexts.
   */
  rename(oldName: string, newName: string, cwd: string = process.cwd()): { path: string; source: "project" | "global" } {
    // Validate both names to prevent path traversal
    const kebabPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    if (!kebabPattern.test(oldName)) {
      throw new Error(`Ungültiger Name "${oldName}". Erlaubt: kebab-case (z.B. my-context).`);
    }
    if (!kebabPattern.test(newName)) {
      throw new Error(`Ungültiger Name "${newName}". Erlaubt: kebab-case (z.B. my-context).`);
    }
    if (oldName === newName) {
      throw new Error(`Alter und neuer Name sind identisch: "${oldName}".`);
    }

    // Find the context to rename
    const localContextPath = join(cwd, ".aios", "context.yaml");
    const isLocal = existsSync(localContextPath) && this.loadContextYaml(localContextPath)?.name === oldName;

    const globalDir = join(CONTEXTS_DIR, oldName);
    const isGlobal = !isLocal && existsSync(join(globalDir, "context.yaml"));

    if (!isLocal && !isGlobal) {
      throw new Error(`Context "${oldName}" nicht gefunden.`);
    }

    // Check target name doesn't already exist
    if (isGlobal) {
      const newGlobalDir = join(CONTEXTS_DIR, newName);
      if (existsSync(join(newGlobalDir, "context.yaml"))) {
        throw new Error(`Context "${newName}" existiert bereits.`);
      }
    }

    // 1. Update context.yaml
    const contextYamlPath = isLocal ? localContextPath : join(globalDir, "context.yaml");
    const config = this.loadContextYaml(contextYamlPath);
    if (!config) {
      throw new Error(`Konnte context.yaml nicht laden: ${contextYamlPath}`);
    }
    config.name = newName;
    writeFileSync(contextYamlPath, stringify(config, { lineWidth: 120 }), "utf-8");

    // 2. For global contexts: rename the directory
    let finalPath: string;
    if (isGlobal) {
      const newGlobalDir = join(CONTEXTS_DIR, newName);
      renameSync(globalDir, newGlobalDir);
      finalPath = newGlobalDir;
    } else {
      finalPath = join(cwd, ".aios");
    }

    // 3. Update active_context if it pointed to the old name
    if (existsSync(ACTIVE_CONTEXT_FILE)) {
      const activeName = readFileSync(ACTIVE_CONTEXT_FILE, "utf-8").trim();
      if (activeName === oldName) {
        writeFileSync(ACTIVE_CONTEXT_FILE, newName, "utf-8");
      }
    }

    // 4. Update links in other contexts that reference the old name
    if (existsSync(CONTEXTS_DIR)) {
      for (const entry of readdirSync(CONTEXTS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const otherYaml = join(CONTEXTS_DIR, entry.name, "context.yaml");
        if (!existsSync(otherYaml)) continue;
        const otherConfig = this.loadContextYaml(otherYaml);
        if (!otherConfig?.links?.length) continue;

        let changed = false;
        for (const link of otherConfig.links) {
          if (link.name === oldName) {
            link.name = newName;
            if (isGlobal && link.path === globalDir) {
              link.path = join(CONTEXTS_DIR, newName);
            }
            changed = true;
          }
        }
        if (changed) {
          writeFileSync(otherYaml, stringify(otherConfig, { lineWidth: 120 }), "utf-8");
        }
      }
    }

    return { path: finalPath, source: isLocal ? "project" : "global" };
  }

  // ─── Helpers ──────────────────────────────────────────

  private loadContextYaml(path: string): ContextConfig | null {
    try {
      const raw = readFileSync(path, "utf-8");
      return parseContextYaml(raw);
    } catch {
      return null;
    }
  }
}
