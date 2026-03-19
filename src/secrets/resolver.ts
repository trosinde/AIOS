/**
 * SecretResolver – Orchestrates secret lookup across multiple backends.
 *
 * Tries providers in priority order, caches results in memory,
 * and logs all access via the AuditLogger.
 */

import type { SecretProvider } from "./secret-provider.js";
import type { AuditLogger } from "../security/audit-logger.js";

export class SecretResolver {
  private providers: SecretProvider[];
  private auditLogger?: AuditLogger;
  private cache = new Map<string, string>();

  constructor(providers: SecretProvider[], auditLogger?: AuditLogger) {
    this.providers = providers;
    this.auditLogger = auditLogger;
  }

  /**
   * Resolve a secret by trying providers in order.
   * Returns undefined if no provider has the secret.
   */
  async resolve(key: string, context_id?: string): Promise<string | undefined> {
    const cacheKey = `${context_id ?? "_global"}:${key}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    for (const provider of this.providers) {
      if (!(await provider.available())) continue;
      const value = await provider.get({ key, context_id });
      if (value !== undefined) {
        this.cache.set(cacheKey, value);
        this.auditLogger?.log({
          level: "info",
          event_type: "secret_access",
          context_id,
          message: `Secret "${key}" resolved via ${provider.name}`,
          metadata: { backend: provider.name, key },
        });
        return value;
      }
    }

    this.auditLogger?.log({
      level: "debug",
      event_type: "secret_access",
      context_id,
      message: `Secret "${key}" not found in any backend`,
      metadata: { key },
    });
    return undefined;
  }

  /**
   * Resolve multiple secrets at once.
   */
  async resolveAll(keys: string[], context_id?: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const key of keys) {
      const value = await this.resolve(key, context_id);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  /**
   * Store a secret using the first available non-env provider, or env as fallback.
   */
  async set(key: string, value: string, context_id?: string): Promise<void> {
    // Prefer non-env provider for writes
    const provider = this.providers.find((p) => p.name !== "env") ?? this.providers[0];
    if (!provider) throw new Error("No secret provider available");

    await provider.set({ key, context_id }, value);
    this.cache.set(`${context_id ?? "_global"}:${key}`, value);

    this.auditLogger?.log({
      level: "info",
      event_type: "secret_write",
      context_id,
      message: `Secret "${key}" stored via ${provider.name}`,
      metadata: { backend: provider.name, key },
    });
  }

  /**
   * Delete a secret from all providers.
   */
  async delete(key: string, context_id?: string): Promise<void> {
    for (const provider of this.providers) {
      if (!(await provider.available())) continue;
      await provider.delete({ key, context_id });
    }
    this.cache.delete(`${context_id ?? "_global"}:${key}`);

    this.auditLogger?.log({
      level: "info",
      event_type: "secret_write",
      context_id,
      message: `Secret "${key}" deleted`,
      metadata: { key },
    });
  }

  /**
   * List all secret keys across all providers.
   */
  async list(context_id?: string): Promise<string[]> {
    const keys = new Set<string>();
    for (const provider of this.providers) {
      if (!(await provider.available())) continue;
      for (const key of await provider.list(context_id)) {
        keys.add(key);
      }
    }
    return [...keys].sort();
  }

  /**
   * Populate process.env with secrets for provider authentication.
   * Called before provider creation to ensure SDK env vars are available.
   */
  async populateEnv(context_id?: string): Promise<void> {
    const envKeys = [
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "OPENAI_API_KEY",
      "OLLAMA_BEARER_TOKEN",
    ];

    for (const key of envKeys) {
      if (process.env[key]) continue; // don't overwrite existing
      const value = await this.resolve(key, context_id);
      if (value) {
        process.env[key] = value;
      }
    }
  }

  /** Clear the in-memory cache. */
  clearCache(): void {
    this.cache.clear();
  }
}
