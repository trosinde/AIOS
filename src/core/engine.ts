import chalk from "chalk";
import type { LLMProvider } from "../agents/provider.js";
import type { PatternRegistry } from "./registry.js";
import type { ExecutionPlan, ExecutionStep, StepResult, StepStatus, WorkflowResult } from "../types.js";

/**
 * Engine – führt einen ExecutionPlan mechanisch aus.
 * Topologische Sortierung, Promise.all für Paralleles, Retry bei Fehler.
 */
export class Engine {
  constructor(
    private registry: PatternRegistry,
    private provider: LLMProvider
  ) {}

  async execute(plan: ExecutionPlan, userInput: string): Promise<WorkflowResult> {
    const results = new Map<string, StepResult>();
    const status = new Map<string, StepStatus>();
    const retries = new Map<string, number>();
    const feedback = new Map<string, string>();
    const start = Date.now();

    plan.plan.steps.forEach((s) => { status.set(s.id, "pending"); retries.set(s.id, 0); });

    // ── Event Loop: startbare Steps finden und parallel ausführen ──
    while ([...status.values()].some((s) => s !== "done" && s !== "failed")) {
      const ready = plan.plan.steps.filter((step) => {
        if (status.get(step.id) !== "pending") return false;
        return step.depends_on.every((dep) => status.get(dep) === "done");
      });

      if (ready.length === 0) break;

      if (ready.length > 1) {
        console.error(chalk.green(`  🔀 Parallel: ${ready.map((s) => s.id).join(" + ")}`));
      }

      ready.forEach((s) => status.set(s.id, "running"));

      await Promise.all(ready.map((step) =>
        this.executeStep(step, userInput, results, status, retries, feedback, plan)
      ));
    }

    // Zusammenfassung
    console.error(chalk.blue("\n─── Ergebnis ───"));
    for (const [id, s] of status) {
      console.error(`  ${s === "done" ? "✅" : "❌"} ${id}`);
    }

    return { plan, results, status, totalDurationMs: Date.now() - start };
  }

  private async executeStep(
    step: ExecutionStep,
    userInput: string,
    results: Map<string, StepResult>,
    status: Map<string, StepStatus>,
    retries: Map<string, number>,
    feedback: Map<string, string>,
    plan: ExecutionPlan
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const pattern = this.registry.get(step.pattern);
      if (!pattern) throw new Error(`Pattern "${step.pattern}" nicht gefunden`);

      // Input aus Dependencies + User-Input zusammenbauen
      let input = this.buildInput(step, userInput, results);
      if (feedback.has(step.id)) {
        input += "\n\n## ⚠️ FEEDBACK AUS VORHERIGEM VERSUCH\n\n" + feedback.get(step.id);
      }

      console.error(chalk.gray(`  ⏳ ${step.id} → ${step.pattern}`));
      const response = await this.provider.complete(pattern.systemPrompt, input);

      // Optional: Quality Gate
      if (step.quality_gate) {
        const score = await this.checkQualityGate(step, response.content);
        if (score < step.quality_gate.min_score) {
          throw new Error(`Quality Gate: ${score}/${step.quality_gate.min_score}`);
        }
      }

      results.set(step.id, {
        stepId: step.id,
        pattern: step.pattern,
        output: response.content,
        durationMs: Date.now() - t0,
      });
      status.set(step.id, "done");
      console.error(chalk.green(`  ✅ ${step.id} (${Date.now() - t0}ms)`));

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const current = retries.get(step.id) ?? 0;
      const max = step.retry?.max ?? 0;

      if (current < max) {
        console.error(chalk.yellow(`  🔄 ${step.id} retry ${current + 1}/${max}`));
        feedback.set(step.id, errMsg);
        retries.set(step.id, current + 1);
        status.set(step.id, "pending");
      } else if (step.retry?.on_failure === "escalate" && step.retry.escalate_to) {
        const target = step.retry.escalate_to;
        console.error(chalk.yellow(`  ⬆️  ${step.id} → eskaliert zu ${target}`));
        feedback.set(target, `Problem in "${step.id}": ${errMsg}`);
        status.set(target, "pending");
        status.set(step.id, "failed");
      } else {
        console.error(chalk.red(`  ❌ ${step.id} gescheitert`));
        status.set(step.id, "failed");
      }
    }
  }

  private buildInput(step: ExecutionStep, userInput: string, results: Map<string, StepResult>): string {
    return step.input_from
      .map((src) => {
        if (src === "$USER_INPUT") return `## Aufgabe\n\n${userInput}`;
        const r = results.get(src);
        return r ? `## Ergebnis von "${src}"\n\n${r.output}` : "";
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  private async checkQualityGate(step: ExecutionStep, content: string): Promise<number> {
    if (!step.quality_gate) return 10;
    const gatePattern = this.registry.get(step.quality_gate.pattern);
    if (!gatePattern) {
      console.error(chalk.yellow(`  ⚠️  Quality Gate Pattern "${step.quality_gate.pattern}" nicht gefunden, übersprungen`));
      return 10;
    }
    const resp = await this.provider.complete(gatePattern.systemPrompt, content);
    const match = resp.content.match(/(\d+)\s*\/?\s*10/);
    return match ? parseInt(match[1]) : 5;
  }
}
