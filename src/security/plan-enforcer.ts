/**
 * Plan Enforcer – Layer 3: Execution Plan Immutability.
 *
 * Implements the Plan-then-Execute pattern:
 * 1. Router creates plan WITHOUT seeing raw user input
 * 2. Plan is frozen (hashed) immediately after creation
 * 3. Engine can only execute steps defined in the frozen plan
 * 4. No dynamic re-planning during execution
 *
 * Reference: Design Patterns for Securing LLM Agents (Beurer-Kellner et al., 2025)
 */

import { createHash } from "crypto";
import type { ExecutionPlan, ExecutionStep } from "../types.js";
import type { AuditLogger } from "./audit-logger.js";

// ─── Types ────────────────────────────────────────────────

export interface FrozenPlan {
  plan: ExecutionPlan;
  hash: string;
  allowedPatterns: Set<string>;
  frozenAt: number;
}

export interface PlanEnforcerConfig {
  planImmutability: boolean;
  validatePatternExists: boolean;
  maxSteps: number;
}

// ─── Default Config ───────────────────────────────────────

export const DEFAULT_ENFORCER_CONFIG: PlanEnforcerConfig = {
  planImmutability: true,
  validatePatternExists: true,
  maxSteps: 20,
};

// ─── Plan Enforcer ────────────────────────────────────────

export class PlanEnforcer {
  private config: PlanEnforcerConfig;
  private auditLogger?: AuditLogger;
  private frozenPlan: FrozenPlan | null = null;

  constructor(config: Partial<PlanEnforcerConfig> = {}, auditLogger?: AuditLogger) {
    this.config = { ...DEFAULT_ENFORCER_CONFIG, ...config };
    this.auditLogger = auditLogger;
  }

  /**
   * Freeze an execution plan. After this, no modifications are allowed.
   * Returns the frozen plan with its integrity hash.
   */
  freeze(plan: ExecutionPlan): FrozenPlan {
    // Validate step count
    if (plan.plan.steps.length > this.config.maxSteps) {
      throw new Error(
        `Plan has ${plan.plan.steps.length} steps, exceeding maximum of ${this.config.maxSteps}`,
      );
    }

    // Validate no circular dependencies
    this.validateDAG(plan.plan.steps);

    // Compute integrity hash
    const planJson = JSON.stringify(plan);
    const hash = createHash("sha256").update(planJson).digest("hex");

    // Build allowed patterns set
    const allowedPatterns = new Set(plan.plan.steps.map((s) => s.pattern));

    const frozen: FrozenPlan = {
      plan: JSON.parse(planJson), // Deep clone to prevent mutation
      hash,
      allowedPatterns,
      frozenAt: Date.now(),
    };

    this.frozenPlan = frozen;
    this.auditLogger?.planFrozen(hash);

    return frozen;
  }

  /**
   * Verify that the current plan hasn't been tampered with.
   */
  verify(plan: ExecutionPlan): boolean {
    if (!this.frozenPlan) return false;

    const currentHash = createHash("sha256")
      .update(JSON.stringify(plan))
      .digest("hex");

    return currentHash === this.frozenPlan.hash;
  }

  /**
   * Check if a pattern is allowed by the frozen plan.
   */
  isPatternAllowed(patternName: string): boolean {
    if (!this.config.planImmutability) return true;
    if (!this.frozenPlan) return true; // No plan frozen yet
    return this.frozenPlan.allowedPatterns.has(patternName);
  }

  /**
   * Validate that a step is part of the frozen plan and matches.
   */
  validateStep(step: ExecutionStep): { valid: boolean; reason?: string } {
    if (!this.config.planImmutability || !this.frozenPlan) {
      return { valid: true };
    }

    // Check pattern is allowed
    if (!this.frozenPlan.allowedPatterns.has(step.pattern)) {
      const reason = `Pattern "${step.pattern}" not in frozen plan. Allowed: [${[...this.frozenPlan.allowedPatterns].join(", ")}]`;
      this.auditLogger?.policyViolation("execute_step", reason);
      return { valid: false, reason };
    }

    // Check step exists in plan
    const planStep = this.frozenPlan.plan.plan.steps.find((s) => s.id === step.id);
    if (!planStep) {
      const reason = `Step "${step.id}" not found in frozen plan`;
      this.auditLogger?.policyViolation("execute_step", reason);
      return { valid: false, reason };
    }

    // Check pattern matches
    if (planStep.pattern !== step.pattern) {
      const reason = `Step "${step.id}" pattern mismatch: expected "${planStep.pattern}", got "${step.pattern}"`;
      this.auditLogger?.policyViolation("execute_step", reason);
      return { valid: false, reason };
    }

    return { valid: true };
  }

  /**
   * Sanitize user input for the Router.
   * Strips potentially dangerous content, leaving only the task description.
   */
  sanitizeForRouter(rawInput: string): string {
    let sanitized = rawInput;

    // Remove XML-like tags that could confuse the Router
    sanitized = sanitized.replace(/<\/?[a-zA-Z_][a-zA-Z0-9_-]*(?:\s[^>]*)?>/g, "");

    // Remove markdown code blocks (could contain hidden instructions)
    sanitized = sanitized.replace(/```[\s\S]*?```/g, "[code block removed]");

    // Remove potential instruction markers
    sanitized = sanitized.replace(/^#{1,6}\s+(SYSTEM|INSTRUCTION|IDENTITY|PURPOSE|RULES|OUTPUT FORMAT)/gim, "");

    // Truncate to reasonable length for task description
    if (sanitized.length > 2000) {
      sanitized = sanitized.slice(0, 2000) + "\n[truncated]";
    }

    return sanitized.trim();
  }

  /**
   * Get the frozen plan (if any).
   */
  getFrozenPlan(): FrozenPlan | null {
    return this.frozenPlan;
  }

  // ─── Internal Validation ──────────────────────────────────

  private validateDAG(steps: ExecutionStep[]): void {
    const ids = new Set(steps.map((s) => s.id));
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected involving step "${id}"`);
      }
      visiting.add(id);
      const step = steps.find((s) => s.id === id);
      if (step) {
        for (const dep of step.depends_on) {
          if (!ids.has(dep)) {
            throw new Error(`Step "${id}" depends on non-existent step "${dep}"`);
          }
          visit(dep);
        }
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const step of steps) {
      visit(step.id);
    }
  }
}
