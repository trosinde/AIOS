import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { readRegistry } from "../context/registry.js";
import { readManifest } from "../context/manifest.js";
import { generateServiceEndpoints } from "./service-generator.js";
import { queryService } from "./query-engine.js";
import { createProvider } from "../agents/provider.js";
import { loadConfig } from "../utils/config.js";
import type { ExecutionContext, ServiceEndpoint, ServiceCallResult, ServiceRequest } from "../types.js";

/**
 * ServiceBus – Koordiniert Service Discovery, Calls und Request-Tracking.
 */
export class ServiceBus {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS service_requests (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        source_context TEXT NOT NULL,
        target_context TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        input TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        response TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_svc_target ON service_requests(target_context, endpoint);
      CREATE INDEX IF NOT EXISTS idx_svc_trace ON service_requests(trace_id);
    `);
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }

  /** Discover all service endpoints across all registered contexts */
  discoverAll(): ServiceEndpoint[] {
    const registry = readRegistry();
    const endpoints: ServiceEndpoint[] = [];

    for (const entry of registry.contexts) {
      try {
        const contextEndpoints = generateServiceEndpoints(entry.path, entry.name);
        endpoints.push(...contextEndpoints);
      } catch {
        // Skip contexts that fail to generate endpoints
      }
    }

    return endpoints;
  }

  /** Discover service endpoints for a specific context */
  discoverForContext(contextName: string): ServiceEndpoint[] {
    const registry = readRegistry();
    const entry = registry.contexts.find((c) => c.name === contextName);
    if (!entry) return [];

    return generateServiceEndpoints(entry.path, entry.name);
  }

  /** Call a service endpoint on a target context */
  async call(
    targetContext: string,
    endpointName: string,
    query: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<ServiceCallResult> {
    // Resolve context
    const registry = readRegistry();
    const entry = registry.contexts.find((c) => c.name === targetContext);
    if (!entry) {
      throw new Error(`Kontext "${targetContext}" nicht in der Registry gefunden`);
    }

    // Check permissions
    try {
      const manifest = readManifest(entry.path);
      if (manifest.permissions?.allow_ipc === false) {
        throw new Error(`Kontext "${targetContext}" erlaubt keine IPC-Anfragen (allow_ipc: false)`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("allow_ipc")) throw err;
      // Manifest read error → proceed anyway (no manifest = no restrictions)
    }

    // Find endpoint
    const endpoints = generateServiceEndpoints(entry.path, entry.name);
    const endpoint = endpoints.find((e) => e.name === endpointName);
    if (!endpoint) {
      const available = endpoints.map((e) => e.name).join(", ");
      throw new Error(
        `Endpoint "${endpointName}" nicht im Kontext "${targetContext}" gefunden. Verfügbar: ${available || "keine"}`,
      );
    }

    // Track request
    const requestId = randomUUID();
    this.insertRequest(requestId, ctx, targetContext, endpointName, query);

    try {
      // Build provider for LLM fallback
      const config = loadConfig();
      let provider;
      try {
        const manifest = readManifest(entry.path);
        const providerName = manifest.config.default_provider || config.defaults.provider;
        const providerCfg = config.providers[providerName];
        if (providerCfg) {
          provider = createProvider(providerCfg);
        }
      } catch {
        // No provider available → direct search only
      }

      const result = await queryService(endpoint, query, entry.path, provider, ctx);

      this.updateRequest(requestId, "completed", JSON.stringify(result.results));

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.updateRequest(requestId, "failed", undefined, errorMsg);
      throw err;
    }
  }

  /** Get request history */
  getHistory(ctx: ExecutionContext, limit = 50): ServiceRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM service_requests
         WHERE source_context = ? OR target_context = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(ctx.context_id, ctx.context_id, limit) as ServiceRequest[];

    return rows;
  }

  private insertRequest(
    id: string,
    ctx: ExecutionContext,
    targetContext: string,
    endpoint: string,
    query: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO service_requests (id, trace_id, source_context, target_context, endpoint, input, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, ctx.trace_id, ctx.context_id, targetContext, endpoint, JSON.stringify(query), Date.now());
  }

  private updateRequest(id: string, status: string, response?: string, error?: string): void {
    this.db
      .prepare(
        `UPDATE service_requests SET status = ?, completed_at = ?, response = ?, error = ? WHERE id = ?`,
      )
      .run(status, Date.now(), response ?? null, error ?? null, id);
  }
}
