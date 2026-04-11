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
import type { DriverCapability, ExecutionContext } from "../types.js";

// ─── Types ────────────────────────────────────────────────

export type PolicyAction =
  | "execute_llm_pattern"
  | "execute_tool_pattern"
  | "execute_mcp_pattern"
  | "write_knowledge"
  | "read_knowledge"
  | "generate_compliance_artifact"
  | "modify_plan"
  | "cross_context_ipc"
  | "use_driver_capability";

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

/**
 * Optionale Erweiterung für Policy-Checks mit Pattern-/Context-Compliance.
 * Wird von Engine bei jedem Step-Dispatch befüllt.
 */
export interface PolicyCheckOptions {
  patternComplianceTags?: string[];   // aus PatternMeta.compliance_tags
  contextComplianceTags?: string[];   // aus ExecutionContext.compliance_tags
  patternName?: string;
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
   * Phase 5.3: Optionale Pattern-/Context-Compliance-Tags werden zusätzlich
   * geprüft — ein Pattern mit compliance_tags darf nur in einem Context laufen
   * der ALLE geforderten Tags bereitstellt.
   */
  check(
    action: PolicyAction,
    taint: TaintLabel,
    traceId?: string,
    opts?: PolicyCheckOptions,
  ): PolicyDecision {
    // Compliance-Tags-Check (orthogonal zur Integrity, immer geprüft wenn vorhanden)
    if (opts?.patternComplianceTags && opts.patternComplianceTags.length > 0) {
      const ctxTags = new Set(opts.contextComplianceTags ?? []);
      const missing = opts.patternComplianceTags.filter(t => !ctxTags.has(t));
      if (missing.length > 0) {
        const reason = `Pattern "${opts.patternName ?? "?"}" benötigt Compliance-Tags [${missing.join(", ")}], Context bietet [${[...ctxTags].join(", ") || "keine"}]`;
        this.auditLogger?.policyViolation(action, reason, taint, traceId);
        return {
          allowed: false,
          action,
          reason,
        };
      }
    }

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
   * Phase 5.3 (Schritt C): prüft ob die vom Driver geforderten Capabilities
   * im aktiven ExecutionContext erlaubt sind. Default-Allowance:
   * file_read + file_write. network/spawn nur wenn explizit freigeschaltet.
   */
  checkDriverCapabilities(
    capabilities: DriverCapability[],
    ctx: ExecutionContext,
    driverName: string,
    traceId?: string,
  ): PolicyDecision {
    const allowed = new Set<DriverCapability>(
      ctx.allowed_driver_capabilities ?? ["file_read", "file_write"],
    );
    const denied = capabilities.filter(c => !allowed.has(c));
    if (denied.length > 0) {
      const reason = `Driver "${driverName}" verlangt Capabilities [${denied.join(", ")}], Context erlaubt nur [${[...allowed].join(", ")}]`;
      this.auditLogger?.policyViolation("use_driver_capability", reason, undefined, traceId);
      return {
        allowed: false,
        action: "use_driver_capability",
        reason,
      };
    }
    return { allowed: true, action: "use_driver_capability" };
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
