/**
 * Cross-Context Engine
 *
 * Führt einen Cross-Context Plan aus.
 * Für jeden Step wird der Ziel-Kontext geladen und dessen
 * lokaler Router/Engine für die Teilaufgabe genutzt.
 */

import { resolve } from "node:path";
import chalk from "chalk";
import { randomUUID } from "node:crypto";
import { readManifest, hasContext, assertPathWithinBase } from "./manifest.js";
import { readRegistry } from "./registry.js";
import { PatternRegistry } from "../core/registry.js";
import { Router } from "../core/router.js";
import { Engine } from "../core/engine.js";
import { PersonaRegistry } from "../core/personas.js";
import { createProvider } from "../agents/provider.js";
import { loadConfig } from "../utils/config.js";
import { AuditLogger } from "../security/audit-logger.js";
import { PolicyEngine, DEFAULT_POLICIES } from "../security/policy-engine.js";
import { InputGuard } from "../security/input-guard.js";
import { KnowledgeGuard } from "../security/knowledge-guard.js";
import { ContentScanner } from "../security/content-scanner.js";
import { ContextManager } from "../core/context.js";
import type {
  CrossContextPlan,
  CrossContextResult,
  CrossContextStepResult,
  ExecutionContext,
  StepStatus,
} from "../types.js";

/** Topologische Sortierung der Steps nach depends_on */
export function topoSort(steps: CrossContextPlan["plan"]["steps"]): CrossContextPlan["plan"]["steps"] {
  const sorted: typeof steps = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Zyklische Abhängigkeit bei Step: ${id}`);
    visiting.add(id);
    const step = stepMap.get(id);
    if (!step) throw new Error(`Step "${id}" nicht gefunden`);
    for (const dep of step.depends_on) {
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(step);
  }

  for (const step of steps) {
    visit(step.id);
  }
  return sorted;
}

/**
 * Validiert einen Cross-Context Plan gegen das erwartete Schema.
 * Verhindert, dass fehlerhafter LLM-Output als Plan ausgeführt wird.
 */
export function validateCrossContextPlan(plan: unknown): CrossContextPlan {
  if (!plan || typeof plan !== "object") {
    throw new Error("Cross-Context Plan ist kein gültiges Objekt");
  }
  const p = plan as Record<string, unknown>;

  if (!p.analysis || typeof p.analysis !== "object") {
    throw new Error("Cross-Context Plan: 'analysis' fehlt oder ist kein Objekt");
  }
  if (!p.plan || typeof p.plan !== "object") {
    throw new Error("Cross-Context Plan: 'plan' fehlt oder ist kein Objekt");
  }

  const planObj = p.plan as Record<string, unknown>;
  if (!["pipe", "scatter_gather", "dag"].includes(planObj.type as string)) {
    throw new Error(`Cross-Context Plan: 'plan.type' ungültig: ${planObj.type}`);
  }
  if (!Array.isArray(planObj.steps) || planObj.steps.length === 0) {
    throw new Error("Cross-Context Plan: 'plan.steps' fehlt oder ist leer");
  }

  for (const step of planObj.steps) {
    if (!step || typeof step !== "object") {
      throw new Error("Cross-Context Plan: Step ist kein Objekt");
    }
    if (!step.id || typeof step.id !== "string") {
      throw new Error("Cross-Context Plan: Step ohne 'id'");
    }
    if (!step.context || typeof step.context !== "string") {
      throw new Error(`Cross-Context Plan: Step "${step.id}" ohne 'context'`);
    }
    if (!step.task || typeof step.task !== "string") {
      throw new Error(`Cross-Context Plan: Step "${step.id}" ohne 'task'`);
    }
    if (!Array.isArray(step.depends_on)) step.depends_on = [];
    if (!Array.isArray(step.input_from)) step.input_from = ["$USER_INPUT"];
  }

  return plan as CrossContextPlan;
}

/** Löst einen Kontext-Namen zum Pfad auf (mit optionalem Registry-Cache) */
function resolveContextPath(contextName: string, registryCache?: ReturnType<typeof readRegistry>): string {
  const registry = registryCache ?? readRegistry();
  const entry = registry.contexts.find((c) => c.name === contextName);
  if (!entry) {
    throw new Error(`Kontext "${contextName}" nicht in der Registry gefunden. Führe 'aios context list' aus.`);
  }
  return entry.path;
}

export class CrossContextEngine {
  async execute(plan: CrossContextPlan, userInput: string, parentCtx?: ExecutionContext): Promise<CrossContextResult> {
    const startTime = Date.now();
    const results = new Map<string, CrossContextStepResult>();
    const status = new Map<string, StepStatus>();

    // Übergeordneter ExecutionContext für den gesamten Cross-Context-Lauf
    const traceId = parentCtx?.trace_id ?? randomUUID();

    // Registry einmal lesen und cachen
    const registryCache = readRegistry();

    // Initialize all steps as pending
    for (const step of plan.plan.steps) {
      status.set(step.id, "pending");
    }

    const sortedSteps = topoSort(plan.plan.steps);

    for (const step of sortedSteps) {
      // Skip step if any dependency failed
      const failedDep = step.depends_on.find((dep) => status.get(dep) === "failed");
      if (failedDep) {
        status.set(step.id, "failed");
        results.set(step.id, {
          stepId: step.id,
          context: step.context,
          output: `ÜBERSPRUNGEN: Abhängigkeit "${failedDep}" fehlgeschlagen`,
          durationMs: 0,
        });
        console.error(chalk.yellow(`   ⏭️  Step ${step.id} übersprungen (Abhängigkeit "${failedDep}" fehlgeschlagen)`));
        continue;
      }

      status.set(step.id, "running");
      const stepStart = Date.now();

      console.error(chalk.blue(`\n🔄 Step ${step.id} → Kontext "${step.context}"`));
      console.error(chalk.gray(`   Aufgabe: ${step.task}`));

      try {
        // Resolve input for this step
        let stepInput = "";
        for (const inputRef of step.input_from) {
          if (inputRef === "$USER_INPUT") {
            stepInput += userInput;
          } else {
            const prevResult = results.get(inputRef);
            if (prevResult) {
              stepInput += (stepInput ? "\n\n" : "") + prevResult.output;
            }
          }
        }

        // Resolve context path (cached registry)
        const contextPath = resolveContextPath(step.context, registryCache);

        if (!hasContext(contextPath)) {
          throw new Error(`Kein AIOS-Kontext in ${contextPath}`);
        }

        const manifest = readManifest(contextPath);
        const config = loadConfig();

        // Build pattern registry for this context (with path traversal protection)
        const patternsDir = resolve(contextPath, ".aios", manifest.config.patterns_dir);
        assertPathWithinBase(patternsDir, contextPath);
        const registry = new PatternRegistry(patternsDir);

        // Use context's provider or fall back to global default
        const providerName = manifest.config.default_provider || config.defaults.provider;
        const providerCfg = config.providers[providerName];
        if (!providerCfg) {
          throw new Error(`Provider "${providerName}" für Kontext "${step.context}" nicht konfiguriert`);
        }
        const provider = createProvider(providerCfg);

        const personasDir = resolve(contextPath, ".aios", manifest.config.personas_dir);
        assertPathWithinBase(personasDir, contextPath);
        const personas = new PersonaRegistry(personasDir);

        // ExecutionContext für diesen Step
        const stepCtx: ExecutionContext = {
          trace_id: traceId,
          context_id: step.context,
          started_at: Date.now(),
        };

        // Create local router + engine for this context
        const router = new Router(registry, provider);
        const crossAuditLogger = new AuditLogger();
        const cm = new ContextManager();
        const activeCtx = cm.resolveActive();
        const mode = activeCtx.config.security?.integrity_policies ?? "relaxed";
        const policies = mode === "strict" ? [...DEFAULT_POLICIES] : [];
        const crossPolicyEngine = new PolicyEngine(policies, crossAuditLogger);
        const engine = new Engine(registry, provider, {
          config, personaRegistry: personas,
          policyEngine: crossPolicyEngine, auditLogger: crossAuditLogger,
          inputGuard: new InputGuard(),
          knowledgeGuard: new KnowledgeGuard({}, crossPolicyEngine, crossAuditLogger),
          contentScanner: new ContentScanner(),
          contextConfig: activeCtx.config,
        });

        // Plan locally within this context
        const localPlan = await router.planWorkflow(step.task + "\n\n" + stepInput, undefined, stepCtx);
        console.error(chalk.gray(`   Lokaler Plan: ${localPlan.plan.type} (${localPlan.plan.steps.length} Schritte)`));

        // Guard against empty plan
        if (localPlan.plan.steps.length === 0) {
          throw new Error(`Kontext "${step.context}" hat einen leeren Plan erzeugt`);
        }

        // Execute locally
        const localResult = await engine.execute(localPlan, stepInput);

        // Collect last step output
        const lastLocalStep = localPlan.plan.steps[localPlan.plan.steps.length - 1];
        const lastOutput = localResult.results.get(lastLocalStep.id);

        const stepResult: CrossContextStepResult = {
          stepId: step.id,
          context: step.context,
          output: lastOutput?.content ?? "",
          localPlan,
          durationMs: Date.now() - stepStart,
        };

        results.set(step.id, stepResult);
        status.set(step.id, "done");

        console.error(chalk.green(`   ✅ Step ${step.id} abgeschlossen (${stepResult.durationMs}ms)`));
      } catch (err) {
        status.set(step.id, "failed");
        results.set(step.id, {
          stepId: step.id,
          context: step.context,
          output: `FEHLER: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - stepStart,
        });
        console.error(chalk.red(`   ❌ Step ${step.id} fehlgeschlagen: ${err instanceof Error ? err.message : err}`));
      }
    }

    return {
      plan,
      results,
      status,
      totalDurationMs: Date.now() - startTime,
    };
  }
}
