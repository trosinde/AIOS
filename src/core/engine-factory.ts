/**
 * Engine Factory – shared construction of Engine + security layers.
 *
 * Used by both the CLI entry (attended, human at terminal) and the MCP
 * server (unattended, driven by another agent). The `unattended` flag
 * flips the security defaults: in unattended mode the factory forces
 * `integrity_policies: strict`, sets `interactive: false` on the
 * ExecutionContext, and caps writes via CircuitBreaker.
 *
 * This module exists so the MCP path cannot drift from the CLI path
 * by accident. Both go through the same builder.
 */

import { join } from "path";
import { Engine } from "./engine.js";
import { PatternRegistry } from "./registry.js";
import { PersonaRegistry } from "./personas.js";
import { ContextManager } from "./context.js";
import { DriverRegistry } from "./driver-registry.js";
import { QualityPipeline } from "./quality/pipeline.js";
import { ExecutionMemory } from "../memory/execution-memory.js";
import { StepExecutor, DEFAULT_ESCALATION } from "./executor.js";
import { CapabilityProviderSelector } from "../agents/selector.js";
import { ProviderSelector } from "../agents/provider-selector.js";
import { createProvider } from "../agents/provider.js";
import { RAGService } from "../rag/rag-service.js";
import { PolicyEngine, DEFAULT_POLICIES } from "../security/policy-engine.js";
import { AuditLogger } from "../security/audit-logger.js";
import { InputGuard } from "../security/input-guard.js";
import { KnowledgeGuard } from "../security/knowledge-guard.js";
import { ContentScanner } from "../security/content-scanner.js";
import type { AiosConfig, QualityLevel, ExecutionContext } from "../types.js";
import type { LLMProvider } from "../agents/provider.js";
import type { McpManager } from "./mcp.js";

// ─── Provider / Executor / Quality / Driver builders ────────

export function buildProviderSelector(config: AiosConfig): ProviderSelector {
  const allProviders = new Map<string, LLMProvider>();
  for (const [name, cfg] of Object.entries(config.providers)) {
    try { allProviders.set(name, createProvider(cfg)); } catch { /* skip unconfigured */ }
  }
  return new ProviderSelector(allProviders, config.providers);
}

/**
 * Memory path for the capability-based selector. Context-scoped so that
 * one context's learning signal cannot disqualify a provider in an
 * unrelated context.
 */
function getMemoryPath(): string {
  const ctx = new ContextManager().resolveActive();
  return join(ctx.path, "memory.json");
}

export function buildStepExecutor(config: AiosConfig): StepExecutor | undefined {
  const hasCapabilityConfig = Object.values(config.providers).some(
    (p) => p.model_capabilities || p.cost,
  );
  if (!hasCapabilityConfig) return undefined;
  const ctx = new ContextManager().resolveActive();
  const memory = new ExecutionMemory(getMemoryPath(), ctx.name);
  const selector = new CapabilityProviderSelector(config.providers, memory);
  return new StepExecutor(selector, memory, config.escalation ?? DEFAULT_ESCALATION);
}

export function buildQualityPipeline(
  config: AiosConfig,
  provider: LLMProvider,
  personas?: PersonaRegistry,
  levelOverride?: QualityLevel,
): QualityPipeline | undefined {
  const qualityConfig = config.quality;
  if (!qualityConfig && !levelOverride) return undefined;

  const effectiveConfig = qualityConfig ?? {
    level: levelOverride ?? "minimal",
    policies: {},
  };
  if (levelOverride) effectiveConfig.level = levelOverride;

  return new QualityPipeline(effectiveConfig, provider, personas, config);
}

export function buildDriverRegistry(): DriverRegistry {
  return new DriverRegistry({ repoRoot: process.cwd() });
}

// ─── Engine builder (the one the CLI + MCP server share) ────

export interface BuildEngineOptions {
  config: AiosConfig;
  registry: PatternRegistry;
  provider: LLMProvider;
  personas: PersonaRegistry;
  mcpManager?: McpManager;
  qualityLevel?: QualityLevel;
  /**
   * Unattended = no human at the terminal. Forces `integrity_policies: strict`
   * and seeds ExecutionContext with `interactive: false` + `max_write_steps`.
   * Activates CodeShield and CircuitBreaker via their `fromContext()` factories.
   *
   * Use this from the MCP server, from cron-driven runs, and from any
   * agent-to-agent wiring. Default: false (CLI attended mode).
   */
  unattended?: boolean;
  /** Override max_write_steps when `unattended: true`. Default: 25. */
  maxWriteSteps?: number;
}

export interface BuiltEngine {
  engine: Engine;
  auditLogger: AuditLogger;
  qualityPipeline?: QualityPipeline;
  providerSelector: ProviderSelector;
}

export function buildEngineContext(opts: BuildEngineOptions): BuiltEngine {
  const ragService = opts.config.rag ? new RAGService(opts.config.rag) : undefined;
  const providerSelector = buildProviderSelector(opts.config);
  const stepExecutor = buildStepExecutor(opts.config);
  const qualityPipeline = buildQualityPipeline(
    opts.config, opts.provider, opts.personas, opts.qualityLevel,
  );
  const driverRegistry = buildDriverRegistry();
  const auditLogger = new AuditLogger();

  const cm = new ContextManager();
  const ctx = cm.resolveActive();

  // Unattended forces strict; attended reads from context (default relaxed).
  const mode = opts.unattended
    ? "strict"
    : (ctx.config.security?.integrity_policies ?? "relaxed");
  const policies = mode === "strict" ? [...DEFAULT_POLICIES] : [];
  const policyEngine = new PolicyEngine(policies, auditLogger);

  const executionContext: Partial<ExecutionContext> | undefined = opts.unattended
    ? { interactive: false, max_write_steps: opts.maxWriteSteps ?? 25 }
    : undefined;

  const engine = new Engine(opts.registry, opts.provider, {
    config: opts.config,
    personaRegistry: opts.personas,
    mcpManager: opts.mcpManager,
    ragService,
    providerSelector,
    stepExecutor,
    qualityPipeline,
    driverRegistry,
    policyEngine,
    auditLogger,
    inputGuard: new InputGuard(),
    knowledgeGuard: new KnowledgeGuard({}, policyEngine, auditLogger),
    contentScanner: new ContentScanner(),
    contextConfig: ctx.config,
    executionContext,
  });

  return { engine, auditLogger, qualityPipeline, providerSelector };
}
