/**
 * Policy Engine – Deterministic security policy enforcement.
 *
 * No LLM heuristics. Pure deterministic rules that check taint labels
 * before allowing actions. Inspired by FIDES (Microsoft, 2025).
 *
 * Policies define what integrity/confidentiality levels are required
 * for each action type. Violations are blocked or queued for review.
 */

import type { TaintLabel, IntegrityLevel, ConfidentialityLevel } from "./taint-tracker.js";
import { meetsIntegrity } from "./taint-tracker.js";
import type { AuditLogger } from "./audit-logger.js";

// ─── Types ────────────────────────────────────────────────

export type PolicyAction =
  | "execute_llm_pattern"
  | "execute_tool_pattern"
  | "execute_mcp_pattern"
  | "write_knowledge"
  | "read_knowledge"
  | "generate_compliance_artifact"
  | "modify_plan"
  | "cross_context_ipc";

export type PolicyViolationAction = "block" | "warn" | "queue_for_review";

export interface Policy {
  action: PolicyAction;
  description: string;
  requires: {
    integrity?: IntegrityLevel[];
    confidentiality?: ConfidentialityLevel[];
  };
  onViolation: PolicyViolationAction;
}

export interface PolicyDecision {
  allowed: boolean;
  action: PolicyAction;
  violatedPolicy?: Policy;
  reason?: string;
}

// ─── Default Policies ─────────────────────────────────────

export const DEFAULT_POLICIES: Policy[] = [
  {
    action: "execute_tool_pattern",
    description: "Tool patterns (CLI execution) require derived+ integrity to prevent shell injection",
    requires: { integrity: ["trusted", "derived"] },
    onViolation: "block",
  },
  {
    action: "execute_mcp_pattern",
    description: "MCP patterns (external service calls) require derived+ integrity",
    requires: { integrity: ["trusted", "derived"] },
    onViolation: "block",
  },
  {
    action: "execute_llm_pattern",
    description: "LLM patterns accept all integrity levels (input guard handles filtering)",
    requires: { integrity: ["trusted", "derived", "untrusted"] },
    onViolation: "warn",
  },
  {
    action: "write_knowledge",
    description: "Knowledge base writes require derived+ integrity to prevent poisoning",
    requires: { integrity: ["trusted", "derived"] },
    onViolation: "queue_for_review",
  },
  {
    action: "read_knowledge",
    description: "Knowledge reads are always allowed (taint labels propagate on read)",
    requires: { integrity: ["trusted", "derived", "untrusted"] },
    onViolation: "warn",
  },
  {
    action: "generate_compliance_artifact",
    description: "Compliance artifacts require trusted data only",
    requires: { integrity: ["trusted"] },
    onViolation: "block",
  },
  {
    action: "modify_plan",
    description: "Plan modification is always blocked (plan immutability)",
    requires: { integrity: [] }, // Nothing meets this requirement
    onViolation: "block",
  },
  {
    action: "cross_context_ipc",
    description: "Cross-context IPC requires derived+ integrity",
    requires: { integrity: ["trusted", "derived"] },
    onViolation: "block",
  },
];

// ─── Policy Engine ────────────────────────────────────────

export class PolicyEngine {
  private policies: Policy[];
  private auditLogger?: AuditLogger;

  constructor(policies?: Policy[], auditLogger?: AuditLogger) {
    this.policies = policies ?? [...DEFAULT_POLICIES];
    this.auditLogger = auditLogger;
  }

  /**
   * Check if an action is allowed given the current taint label.
   */
  check(action: PolicyAction, taint: TaintLabel, traceId?: string): PolicyDecision {
    const policy = this.policies.find((p) => p.action === action);

    // No policy found → allow by default (open policy)
    if (!policy) {
      return { allowed: true, action };
    }

    // Check integrity requirement
    if (policy.requires.integrity) {
      const allowed = policy.requires.integrity.some(
        (required) => meetsIntegrity(taint, required),
      );

      if (!allowed) {
        const reason = `Action "${action}" requires integrity [${policy.requires.integrity.join("|")}] but got "${taint.integrity}" (source: ${taint.source})`;

        if (policy.onViolation === "block") {
          this.auditLogger?.policyViolation(action, reason, taint, traceId);
        }

        return {
          allowed: policy.onViolation === "warn",
          action,
          violatedPolicy: policy,
          reason,
        };
      }
    }

    this.auditLogger?.log({
      level: "debug",
      event_type: "policy_passed",
      trace_id: traceId,
      message: `Policy check passed: ${action} (integrity=${taint.integrity})`,
    });

    return { allowed: true, action };
  }

  /**
   * Add a custom policy.
   */
  addPolicy(policy: Policy): void {
    // Replace existing policy for same action
    const idx = this.policies.findIndex((p) => p.action === policy.action);
    if (idx >= 0) {
      this.policies[idx] = policy;
    } else {
      this.policies.push(policy);
    }
  }

  /**
   * Get all policies.
   */
  getPolicies(): readonly Policy[] {
    return this.policies;
  }
}
