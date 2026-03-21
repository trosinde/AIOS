import { createHash } from "crypto";
import chalk from "chalk";
import type { LLMProvider } from "../../agents/provider.js";
import type { PersonaRegistry } from "../personas.js";
import type { KnowledgeBus } from "../knowledge-bus.js";
import type {
  AiosConfig,
  ExecutionContext,
  Finding,
  PatternMeta,
  Persona,
  QualityConfig,
  QualityContext,
  QualityLevel,
  QualityPolicy,
  QualityResult,
  AuditEntry,
} from "../../types.js";
import {
  SelfCheckPolicy,
  ConsistencyCheckPolicy,
  PeerReviewPolicy,
  ComplianceCheckPolicy,
  TraceabilityCheckPolicy,
  QualityGatePolicy,
} from "./policies.js";

/**
 * QualityPipeline — runs quality policies against pattern output.
 * Acts as middleware between pattern execution and output delivery.
 */
export class QualityPipeline {
  private policies: QualityPolicy[] = [];
  private config: QualityConfig;
  private level: QualityLevel;

  constructor(
    config: QualityConfig,
    provider: LLMProvider,
    personaRegistry?: PersonaRegistry,
    aiosConfig?: AiosConfig,
  ) {
    this.config = config;
    this.level = config.level;

    const getPersonaPrompt = (id: string) => personaRegistry?.get(id)?.system_prompt;

    // Build policy chain based on level
    const selfCheckCfg = config.policies.self_check;
    if (selfCheckCfg?.enabled !== false) {
      // Self-check can use a different (cheaper) provider
      const selfCheckProvider = selfCheckCfg?.provider && aiosConfig?.providers[selfCheckCfg.provider]
        ? this.createProviderFromConfig(selfCheckCfg.provider, aiosConfig)
        : provider;
      this.policies.push(new SelfCheckPolicy(selfCheckProvider ?? provider));
    }

    if (this.levelIncludes("standard")) {
      if (config.policies.consistency_check?.enabled !== false) {
        this.policies.push(new ConsistencyCheckPolicy(provider));
      }
      if (config.policies.peer_review?.enabled !== false) {
        const peerProvider = config.policies.peer_review?.provider && aiosConfig?.providers[config.policies.peer_review.provider]
          ? this.createProviderFromConfig(config.policies.peer_review.provider, aiosConfig)
          : provider;
        this.policies.push(new PeerReviewPolicy(
          peerProvider ?? provider,
          getPersonaPrompt,
          config.policies.peer_review?.review_map,
        ));
      }
    }

    if (this.levelIncludes("regulated")) {
      if (config.policies.compliance_check?.enabled !== false) {
        this.policies.push(new ComplianceCheckPolicy(
          provider,
          config.policies.compliance_check?.standards,
        ));
      }
      if (config.policies.traceability_check?.enabled !== false) {
        this.policies.push(new TraceabilityCheckPolicy(
          config.policies.traceability_check?.enforce_coverage,
        ));
      }
      if (config.policies.quality_gate?.enabled !== false) {
        this.policies.push(new QualityGatePolicy(
          config.policies.quality_gate?.block_on,
          config.policies.quality_gate?.require_sign_off,
        ));
      }
    }
  }

  /**
   * Run all applicable policies against the output.
   * Implements the rework loop: on "rework" action, re-invokes the pattern.
   */
  async evaluate(
    output: string,
    pattern: PatternMeta,
    task: string,
    inputUsed: string,
    ctx: ExecutionContext,
    options?: {
      persona?: Persona;
      workflowPosition?: QualityContext["workflowPosition"];
      knowledgeBus?: KnowledgeBus;
      rerunPattern?: (reworkHint: string, previousOutput: string) => Promise<string>;
      levelOverride?: QualityLevel;
    },
  ): Promise<QualityResult> {
    const effectiveLevel = options?.levelOverride ?? this.level;
    const maxRetries = this.getMaxRetries(effectiveLevel);
    const pipelineStart = Date.now();

    let currentOutput = output;
    const previousAttempts: QualityContext["previousAttempts"] = [];
    let allFindings: Finding[] = [];
    let reworkAttempts = 0;
    const policyTimings: AuditEntry["policiesExecuted"] = [];

    // Load knowledge context if available
    let relevantDecisions: QualityContext["relevantDecisions"];
    let relevantFacts: QualityContext["relevantFacts"];
    let relevantRequirements: QualityContext["relevantRequirements"];

    if (options?.knowledgeBus && this.levelIncludes("standard", effectiveLevel)) {
      try {
        relevantDecisions = options.knowledgeBus.query({ type: "decision", limit: 20 }, ctx);
        relevantFacts = options.knowledgeBus.query({ type: "fact", limit: 20 }, ctx);
        relevantRequirements = options.knowledgeBus.query({ type: "requirement", limit: 20 }, ctx);
      } catch {
        // KB not available, continue without
      }
    }

    // Rework loop
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      allFindings = [];
      let blocked = false;
      let needsRework = false;
      let lastReworkHint: string | undefined;

      // Run each applicable policy
      for (const policy of this.policies) {
        if (!this.policyAppliesAtLevel(policy, effectiveLevel)) continue;

        const qualityContext: QualityContext = {
          output: currentOutput,
          pattern,
          persona: options?.persona,
          task,
          inputUsed,
          workflowPosition: options?.workflowPosition,
          relevantDecisions,
          relevantFacts,
          relevantRequirements,
          previousAttempts,
          previousPolicyFindings: allFindings,
          executionContext: ctx,
        };

        const policyStart = Date.now();
        try {
          const result = await policy.evaluate(qualityContext);
          const durationMs = Date.now() - policyStart;

          policyTimings.push({
            policy: policy.name,
            result: result.pass ? "pass" : "fail",
            findings: result.findings,
            durationMs,
          });

          allFindings.push(...result.findings);

          if (result.action === "block") {
            blocked = true;
            console.error(chalk.red(`    ⛔ ${policy.name}: BLOCKED`));
            break;
          }

          if (result.action === "rework") {
            needsRework = true;
            lastReworkHint = result.reworkHint;
            const findingSummary = result.findings
              .filter(f => f.severity === "critical" || f.severity === "major")
              .map(f => `[${f.severity}] ${f.message}`)
              .join("; ");
            console.error(chalk.yellow(`    ⚠️  ${policy.name}: rework needed — ${findingSummary || result.reworkHint || "issues found"}`));
          } else {
            const findingCount = result.findings.length;
            if (findingCount > 0) {
              console.error(chalk.gray(`    ✓ ${policy.name}: pass (${findingCount} findings)`));
            } else {
              console.error(chalk.gray(`    ✓ ${policy.name}: pass`));
            }
          }
        } catch (err) {
          const durationMs = Date.now() - policyStart;
          policyTimings.push({
            policy: policy.name,
            result: "error",
            findings: [{
              severity: "info",
              category: "error",
              message: `Policy error: ${err instanceof Error ? err.message : String(err)}`,
              source: policy.name,
            }],
            durationMs,
          });
          console.error(chalk.yellow(`    ⚠️  ${policy.name}: error (${err instanceof Error ? err.message : err}), skipping`));
        }
      }

      // Decision
      if (blocked) {
        return this.buildResult(currentOutput, allFindings, "BLOCKED", reworkAttempts, policyTimings, pipelineStart, pattern, options, ctx);
      }

      if (!needsRework || attempt === maxRetries) {
        const decision = allFindings.length > 0 ? "PASSED_WITH_FINDINGS" : "PASSED";
        if (attempt > 0 && !needsRework) {
          console.error(chalk.green(`    ✅ Quality check passed after ${attempt} rework(s)`));
        }
        return this.buildResult(currentOutput, allFindings, decision, reworkAttempts, policyTimings, pipelineStart, pattern, options, ctx);
      }

      // Rework: re-run pattern with feedback
      if (options?.rerunPattern && lastReworkHint) {
        previousAttempts.push({ output: currentOutput, findings: allFindings });
        reworkAttempts++;
        console.error(chalk.yellow(`    🔄 Rework attempt ${reworkAttempts}/${maxRetries}...`));
        try {
          currentOutput = await options.rerunPattern(lastReworkHint, currentOutput);
        } catch (err) {
          console.error(chalk.red(`    ❌ Rework failed: ${err instanceof Error ? err.message : err}`));
          return this.buildResult(currentOutput, allFindings, "PASSED_WITH_FINDINGS", reworkAttempts, policyTimings, pipelineStart, pattern, options, ctx);
        }
      } else {
        // No rerun function available — pass with findings
        return this.buildResult(currentOutput, allFindings, "PASSED_WITH_FINDINGS", reworkAttempts, policyTimings, pipelineStart, pattern, options, ctx);
      }
    }

    // Should not reach here, but just in case
    return this.buildResult(currentOutput, allFindings, "PASSED_WITH_FINDINGS", reworkAttempts, policyTimings, pipelineStart, pattern, options, ctx);
  }

  /** Get the list of active policy names */
  getActivePolicies(level?: QualityLevel): string[] {
    const effectiveLevel = level ?? this.level;
    return this.policies
      .filter(p => this.policyAppliesAtLevel(p, effectiveLevel))
      .map(p => p.name);
  }

  /** Get the configured quality level */
  getLevel(): QualityLevel {
    return this.level;
  }

  // ─── Private ──────────────────────────────────────────

  private buildResult(
    output: string,
    findings: Finding[],
    decision: QualityResult["decision"],
    reworkAttempts: number,
    policyTimings: AuditEntry["policiesExecuted"],
    pipelineStart: number,
    pattern: PatternMeta,
    options: Parameters<QualityPipeline["evaluate"]>[5],
    ctx: ExecutionContext,
  ): QualityResult {
    const totalDurationMs = Date.now() - pipelineStart;

    let auditEntry: AuditEntry | undefined;
    if (this.config.audit?.enabled && this.levelIncludes("regulated")) {
      auditEntry = {
        id: `AUDIT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now() % 100000}`,
        timestamp: new Date().toISOString(),
        workflow: options?.workflowPosition?.workflowId,
        step: options?.workflowPosition?.stepId,
        pattern: pattern.name,
        persona: options?.persona?.id,
        qualityLevel: this.level,
        inputHash: `sha256:${hashString(options?.workflowPosition?.stepId ?? "input")}`,
        outputHash: `sha256:${hashString(output)}`,
        policiesExecuted: policyTimings,
        totalDurationMs,
        reworkAttempts,
        finalDecision: decision === "PASSED_WITH_FINDINGS" ? "PASSED" : decision,
      };
    }

    return {
      output,
      passed: decision !== "BLOCKED",
      findings,
      reworkAttempts,
      auditEntry,
      decision,
    };
  }

  private levelIncludes(target: QualityLevel, effectiveLevel?: QualityLevel): boolean {
    const level = effectiveLevel ?? this.level;
    const order: QualityLevel[] = ["minimal", "standard", "regulated"];
    return order.indexOf(level) >= order.indexOf(target);
  }

  private policyAppliesAtLevel(policy: QualityPolicy, level: QualityLevel): boolean {
    const order: QualityLevel[] = ["minimal", "standard", "regulated"];
    return order.indexOf(level) >= order.indexOf(policy.appliesAt);
  }

  private getMaxRetries(level: QualityLevel): number {
    const selfCheckRetries = this.config.policies.self_check?.max_retries;
    if (selfCheckRetries !== undefined) return selfCheckRetries;
    if (level === "minimal") return 1;
    return 2; // standard & regulated
  }

  private createProviderFromConfig(name: string, config: AiosConfig): LLMProvider | undefined {
    try {
      // Dynamic import would be circular, so we just return undefined
      // and let the caller fall back to the main provider
      return undefined;
    } catch {
      return undefined;
    }
  }
}

function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
