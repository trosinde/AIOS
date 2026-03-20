/**
 * Cross-Context Engine
 *
 * Führt einen Cross-Context Plan aus.
 * Für jeden Step wird der Ziel-Kontext geladen und dessen
 * lokaler Router/Engine für die Teilaufgabe genutzt.
 */

import { resolve, join } from "node:path";
import chalk from "chalk";
import { readManifest, hasContext } from "./manifest.js";
import { readRegistry } from "./registry.js";
import { PatternRegistry } from "../core/registry.js";
import { Router } from "../core/router.js";
import { Engine } from "../core/engine.js";
import { PersonaRegistry } from "../core/personas.js";
import { createProvider } from "../agents/provider.js";
import { loadConfig } from "../utils/config.js";
import type {
  CrossContextPlan,
  CrossContextResult,
  CrossContextStepResult,
  StepStatus,
} from "../types.js";

/** Topologische Sortierung der Steps nach depends_on */
function topoSort(steps: CrossContextPlan["plan"]["steps"]): CrossContextPlan["plan"]["steps"] {
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

/** Löst einen Kontext-Namen zum Pfad auf */
function resolveContextPath(contextName: string): string {
  const registry = readRegistry();
  const entry = registry.contexts.find((c) => c.name === contextName);
  if (!entry) {
    throw new Error(`Kontext "${contextName}" nicht in der Registry gefunden. Führe 'aios context list' aus.`);
  }
  return entry.path;
}

export class CrossContextEngine {
  async execute(plan: CrossContextPlan, userInput: string): Promise<CrossContextResult> {
    const startTime = Date.now();
    const results = new Map<string, CrossContextStepResult>();
    const status = new Map<string, StepStatus>();

    // Initialize all steps as pending
    for (const step of plan.plan.steps) {
      status.set(step.id, "pending");
    }

    const sortedSteps = topoSort(plan.plan.steps);

    for (const step of sortedSteps) {
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

        // Resolve context path
        const contextPath = resolveContextPath(step.context);

        if (!hasContext(contextPath)) {
          throw new Error(`Kein AIOS-Kontext in ${contextPath}`);
        }

        const manifest = readManifest(contextPath);
        const config = loadConfig();

        // Build pattern registry for this context
        const patternsDir = resolve(contextPath, ".aios", manifest.config.patterns_dir);
        const registry = new PatternRegistry(patternsDir);

        // Use context's provider or fall back to global default
        const providerName = manifest.config.default_provider || config.defaults.provider;
        const providerCfg = config.providers[providerName];
        if (!providerCfg) {
          throw new Error(`Provider "${providerName}" für Kontext "${step.context}" nicht konfiguriert`);
        }
        const provider = createProvider(providerCfg);
        const personas = new PersonaRegistry(
          resolve(contextPath, ".aios", manifest.config.personas_dir)
        );

        // Create local router + engine for this context
        const router = new Router(registry, provider);
        const engine = new Engine(registry, provider, config, personas);

        // Plan locally within this context
        const localPlan = await router.planWorkflow(step.task + "\n\n" + stepInput);
        console.error(chalk.gray(`   Lokaler Plan: ${localPlan.plan.type} (${localPlan.plan.steps.length} Schritte)`));

        // Execute locally
        const localResult = await engine.execute(localPlan, stepInput);

        // Collect last step output
        const lastLocalStep = localPlan.plan.steps[localPlan.plan.steps.length - 1];
        const lastOutput = localResult.results.get(lastLocalStep.id);

        const stepResult: CrossContextStepResult = {
          stepId: step.id,
          context: step.context,
          output: lastOutput?.output ?? "",
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
