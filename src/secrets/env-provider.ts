/**
 * EnvSecretProvider – Fallback backend using .env files.
 *
 * Reads from context-scoped .env → global .env → process.env.
 * Always available, zero external dependencies.
 */

import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { SecretProvider, SecretRef } from "./secret-provider.js";

function getAiosHome(): string {
  return join(process.env.HOME ?? homedir(), ".aios");
}

export class EnvSecretProvider implements SecretProvider {
  readonly name = "env";

  async available(): Promise<boolean> {
    return true;
  }

  async get(ref: SecretRef): Promise<string | undefined> {
    // 1. Context-scoped .env
    if (ref.context_id && ref.context_id !== "default") {
      const contextEnv = this.loadEnvFile(
        join(getAiosHome(), "contexts", ref.context_id, ".env")
      );
      if (contextEnv.has(ref.key)) return contextEnv.get(ref.key);
    }

    // 2. Global .env
    const globalEnv = this.loadEnvFile(join(getAiosHome(), ".env"));
    if (globalEnv.has(ref.key)) return globalEnv.get(ref.key);

    // 3. process.env
    return process.env[ref.key];
  }

  async set(ref: SecretRef, value: string): Promise<void> {
    const envPath = this.envPathFor(ref.context_id);
    mkdirSync(dirname(envPath), { recursive: true });
    this.upsertEnvFile(envPath, ref.key, value);
  }

  async delete(ref: SecretRef): Promise<void> {
    const envPath = this.envPathFor(ref.context_id);
    if (!existsSync(envPath)) return;
    this.removeFromEnvFile(envPath, ref.key);
  }

  async list(context_id?: string): Promise<string[]> {
    const keys = new Set<string>();

    // Context-scoped
    if (context_id && context_id !== "default") {
      const contextEnv = this.loadEnvFile(
        join(getAiosHome(), "contexts", context_id, ".env")
      );
      for (const k of contextEnv.keys()) keys.add(k);
    }

    // Global
    const globalEnv = this.loadEnvFile(join(getAiosHome(), ".env"));
    for (const k of globalEnv.keys()) keys.add(k);

    return [...keys].sort();
  }

  // ─── Helpers ────────────────────────────────────────────

  private envPathFor(context_id?: string): string {
    if (context_id && context_id !== "default") {
      return join(getAiosHome(), "contexts", context_id, ".env");
    }
    return join(getAiosHome(), ".env");
  }

  private loadEnvFile(path: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!existsSync(path)) return map;
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      map.set(key, value);
    }
    return map;
  }

  private upsertEnvFile(path: string, key: string, value: string): void {
    const lines: string[] = [];
    let found = false;

    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf-8").split("\n")) {
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
        const k = trimmed.slice(0, eqIndex).trim();
        if (k === key) {
          lines.push(`${key}=${value}`);
          found = true;
        } else {
          lines.push(line);
        }
      }
    }

    if (!found) {
      lines.push(`${key}=${value}`);
    }

    writeFileSync(path, lines.join("\n") + "\n", "utf-8");
    chmodSync(path, 0o600);
  }

  private removeFromEnvFile(path: string, key: string): void {
    if (!existsSync(path)) return;
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return true;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) return true;
        return trimmed.slice(0, eqIndex).trim() !== key;
      });
    writeFileSync(path, lines.join("\n") + "\n", "utf-8");
    chmodSync(path, 0o600);
  }
}
