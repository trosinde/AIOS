import chalk from "chalk";
import type {
  Pattern,
  EscalationConfig,
  ExecutionContext,
  LLMResponse,
  RankedProvider,
} from "../types.js";
import type { CapabilityProviderSelector } from "../agents/selector.js";
import type { ExecutionMemory } from "../memory/execution-memory.js";
import type { LLMProvider } from "../agents/provider.js";
import { createProvider } from "../agents/provider.js";
import { PromptBuilder } from "../security/prompt-builder.js";

/**
 * StepExecutor – runs a single LLM-pattern step with capability-based
 * provider selection, automatic retries, and escalation to stronger
 * models on failure. Every attempt is logged to ExecutionMemory so the
 * selector can learn over time.
 */

export interface StepExecutionResult {
  response: LLMResponse;
  provider: string;
  model: string;
  attempt: number;
  escalationPath: string[];
  durationMs: number;
}

export interface ExecutorContext {
  stepId: string;
  workflowId: string;
  execCtx: ExecutionContext;
  systemPromptOverride?: string;
  images?: string[];
}

export const DEFAULT_ESCALATION: EscalationConfig = {
  maxRetries: 2,
  strategy: "upgrade_on_fail",
  retrySameTierFirst: true,
  cooldownMs: 1000,
};

export class StepExecutor {
  private promptBuilder = new PromptBuilder();

  constructor(
    private selector: CapabilityProviderSelector,
    private memory: ExecutionMemory,
    private escalation: EscalationConfig = DEFAULT_ESCALATION,
  ) {}

  /**
   * Execute a pattern with retries + escalation.
   * The Engine still wraps this in its own failure handling (Saga rollback,
   * escalate_to pattern references, etc.).
   */
  async execute(
    pattern: Pattern,
    userInput: string,
    ctx: ExecutorContext,
  ): Promise<StepExecutionResult> {
    let selected: RankedProvider = this.selector.select(pattern.meta);
    let attempt = 0;
    let lastError: unknown = null;
    const escalationPath: string[] = [selected.name];

    const maxAttempts = 1 + this.escalation.maxRetries;

    while (attempt < maxAttempts) {
      attempt++;
      const provider: LLMProvider = createProvider(selected.config);
      const systemPrompt = ctx.systemPromptOverride ?? pattern.systemPrompt;
      const start = Date.now();

      try {
        // Data/Instruction Separation: wrap user input as untrusted data.
        const built = this.promptBuilder.build(
          systemPrompt,
          userInput,
          [],
          ctx.execCtx.trace_id,
        );
        const response = await provider.complete(
          built.systemPrompt,
          built.userMessage,
          ctx.images,
          ctx.execCtx,
        );
        const durationMs = Date.now() - start;

        this.memory.log({
          timestamp: new Date().toISOString(),
          pattern: pattern.meta.name,
          provider: selected.name,
          model: selected.config.model,
          costTier: selected.costTier,
          outcome: "success",
          attempt,
          escalatedFrom:
            attempt > 1 ? escalationPath[escalationPath.length - 2] : undefined,
          durationMs,
          tokensInput: response.tokensUsed.input,
          tokensOutput: response.tokensUsed.output,
          stepId: ctx.stepId,
          workflowId: ctx.workflowId,
          traceId: ctx.execCtx.trace_id,
        });

        console.error(
          chalk.gray(
            `    ✓ ${pattern.meta.name} → ${selected.name} (${durationMs}ms, Attempt ${attempt}/${maxAttempts})`,
          ),
        );

        return {
          response,
          provider: selected.name,
          model: selected.config.model,
          attempt,
          escalationPath: [...escalationPath],
          durationMs,
        };
      } catch (error) {
        const durationMs = Date.now() - start;
        const errorType = classifyError(error);
        const isFinalAttempt = attempt >= maxAttempts;

        this.memory.log({
          timestamp: new Date().toISOString(),
          pattern: pattern.meta.name,
          provider: selected.name,
          model: selected.config.model,
          costTier: selected.costTier,
          outcome: isFinalAttempt ? "failed" : "retry",
          errorType,
          attempt,
          escalatedFrom:
            attempt > 1 ? escalationPath[escalationPath.length - 2] : undefined,
          durationMs,
          tokensInput: 0,
          tokensOutput: 0,
          stepId: ctx.stepId,
          workflowId: ctx.workflowId,
          traceId: ctx.execCtx.trace_id,
        });

        console.error(
          chalk.yellow(
            `    ✗ ${pattern.meta.name} → ${selected.name} failed: ${errorType} (Attempt ${attempt}/${maxAttempts})`,
          ),
        );

        lastError = error;

        if (!isFinalAttempt) {
          if (this.shouldUpgrade(attempt)) {
            const upgrade = this.selector.selectUpgrade(selected.name, pattern.meta);
            if (upgrade) {
              console.error(
                chalk.yellow(`    ⬆ Escalation: ${selected.name} → ${upgrade.name}`),
              );
              selected = upgrade;
              escalationPath.push(upgrade.name);
            } else {
              // No upgrade available → retry same provider
              escalationPath.push(selected.name);
            }
          } else {
            escalationPath.push(selected.name);
          }
          if (this.escalation.cooldownMs > 0) {
            await sleep(this.escalation.cooldownMs);
          }
        }
      }
    }

    const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `Step "${ctx.stepId}" (${pattern.meta.name}) failed after ${attempt} attempts. ` +
        `Path: ${escalationPath.join(" → ")}. Last error: ${errMsg}`,
    );
  }

  private shouldUpgrade(attempt: number): boolean {
    if (this.escalation.strategy === "fail_fast") return false;
    if (this.escalation.strategy === "same_model_retry") return false;
    // upgrade_on_fail:
    if (this.escalation.retrySameTierFirst && attempt === 1) return false;
    return true;
  }
}

/** Map an error into a coarse category for memory statistics. */
export function classifyError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/JSON|parse/i.test(msg)) return "invalid_json";
  if (/timeout|timed out/i.test(msg)) return "timeout";
  if (/429|rate[ _]?limit/i.test(msg)) return "rate_limit";
  if (/\b401\b|\b403\b|unauthoriz|forbidden/i.test(msg)) return "auth_error";
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) return "connection_error";
  if (/quality/i.test(msg)) return "quality_low";
  return "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
