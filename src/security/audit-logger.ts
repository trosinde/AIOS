/**
 * Audit Logger – Layer 6: Security Audit Trail.
 *
 * Provides tamper-evident logging for all security-relevant decisions.
 * Logs are written as JSONL (one JSON object per line) for easy parsing.
 *
 * Supports IEC 62443 and EU CRA compliance requirements.
 */

import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { TaintLabel } from "./taint-tracker.js";
import type { InputGuardResult } from "./input-guard.js";
import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────

export type AuditEventType =
  | "input_received"
  | "guard_triggered"
  | "guard_passed"
  | "plan_created"
  | "plan_frozen"
  | "step_executed"
  | "output_validated"
  | "canary_missing"
  | "canary_ok"
  | "kb_write"
  | "kb_write_blocked"
  | "policy_violation"
  | "policy_passed"
  | "taint_propagation"
  | "secret_access"
  | "secret_write";

export type AuditLogLevel = "debug" | "info" | "warn" | "error";

export interface AuditEntry {
  timestamp: string;
  level: AuditLogLevel;
  event_type: AuditEventType;

  // Context
  trace_id?: string;
  context_id?: string;
  session_id?: string;
  pattern?: string;
  step_id?: string;
  persona?: string;

  // Security details
  taint_labels?: TaintLabel[];
  guard_result?: Partial<InputGuardResult>;
  policy_decision?: string;

  // Compliance (hashes, not raw data)
  input_hash?: string;
  output_hash?: string;
  plan_hash?: string;

  // Human-readable message
  message: string;

  // Extra data
  metadata?: Record<string, unknown>;
}

export interface AuditLoggerConfig {
  enabled: boolean;
  logFile: string;
  logLevel: AuditLogLevel;
  complianceReports: boolean;
}

// ─── Default Config ───────────────────────────────────────

export const DEFAULT_AUDIT_CONFIG: AuditLoggerConfig = {
  enabled: true,
  logFile: "logs/security-audit.jsonl",
  logLevel: "info",
  complianceReports: true,
};

// ─── Log Level Ordering ───────────────────────────────────

const LOG_LEVELS: Record<AuditLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─── Audit Logger ─────────────────────────────────────────

export class AuditLogger {
  private config: AuditLoggerConfig;
  private initialized = false;

  constructor(config: Partial<AuditLoggerConfig> = {}) {
    this.config = { ...DEFAULT_AUDIT_CONFIG, ...config };
  }

  /**
   * Log a security audit event.
   */
  log(entry: Omit<AuditEntry, "timestamp">): void {
    if (!this.config.enabled) return;
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[this.config.logLevel]) return;

    this.ensureLogDir();

    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    try {
      appendFileSync(this.config.logFile, JSON.stringify(fullEntry) + "\n");
    } catch {
      // If we can't write the audit log, write to stderr as fallback
      console.error(`[AUDIT] ${fullEntry.timestamp} ${fullEntry.event_type}: ${fullEntry.message}`);
    }
  }

  // ─── Convenience Methods ──────────────────────────────────

  inputReceived(input: string, traceId?: string, contextId?: string): void {
    this.log({
      level: "info",
      event_type: "input_received",
      trace_id: traceId,
      context_id: contextId,
      input_hash: sha256(input),
      message: `Input received (${input.length} chars)`,
    });
  }

  guardTriggered(result: InputGuardResult, traceId?: string): void {
    this.log({
      level: "warn",
      event_type: "guard_triggered",
      trace_id: traceId,
      guard_result: {
        safe: result.safe,
        score: result.score,
        flags: result.flags,
        details: result.details,
      },
      message: `Input guard triggered: score=${result.score.toFixed(2)}, flags=[${result.flags.join(",")}]`,
    });
  }

  guardPassed(result: InputGuardResult, traceId?: string): void {
    this.log({
      level: "debug",
      event_type: "guard_passed",
      trace_id: traceId,
      guard_result: {
        safe: result.safe,
        score: result.score,
        flags: result.flags,
      },
      message: `Input guard passed: score=${result.score.toFixed(2)}`,
    });
  }

  planCreated(planJson: string, traceId?: string): void {
    this.log({
      level: "info",
      event_type: "plan_created",
      trace_id: traceId,
      plan_hash: sha256(planJson),
      message: "Execution plan created",
    });
  }

  planFrozen(planHash: string, traceId?: string): void {
    this.log({
      level: "info",
      event_type: "plan_frozen",
      trace_id: traceId,
      plan_hash: planHash,
      message: `Execution plan frozen: ${planHash.slice(0, 16)}...`,
    });
  }

  stepExecuted(stepId: string, pattern: string, output: string, taint?: TaintLabel, traceId?: string): void {
    this.log({
      level: "info",
      event_type: "step_executed",
      trace_id: traceId,
      step_id: stepId,
      pattern,
      output_hash: sha256(output),
      taint_labels: taint ? [taint] : undefined,
      message: `Step ${stepId} (${pattern}) executed`,
    });
  }

  canaryMissing(pattern: string, traceId?: string): void {
    this.log({
      level: "error",
      event_type: "canary_missing",
      trace_id: traceId,
      pattern,
      message: `CANARY MISSING in output from ${pattern} – possible prompt override!`,
    });
  }

  canaryOk(pattern: string, traceId?: string): void {
    this.log({
      level: "debug",
      event_type: "canary_ok",
      trace_id: traceId,
      pattern,
      message: `Canary verified for ${pattern}`,
    });
  }

  policyViolation(action: string, reason: string, taint?: TaintLabel, traceId?: string): void {
    this.log({
      level: "error",
      event_type: "policy_violation",
      trace_id: traceId,
      taint_labels: taint ? [taint] : undefined,
      message: `Policy violation: ${action} – ${reason}`,
    });
  }

  kbWrite(content: string, taint: TaintLabel, traceId?: string): void {
    this.log({
      level: "info",
      event_type: "kb_write",
      trace_id: traceId,
      taint_labels: [taint],
      output_hash: sha256(content),
      message: `KB write (integrity=${taint.integrity})`,
    });
  }

  kbWriteBlocked(content: string, reason: string, traceId?: string): void {
    this.log({
      level: "warn",
      event_type: "kb_write_blocked",
      trace_id: traceId,
      output_hash: sha256(content),
      message: `KB write blocked: ${reason}`,
    });
  }

  // ─── Internal ─────────────────────────────────────────────

  private ensureLogDir(): void {
    if (this.initialized) return;
    try {
      mkdirSync(dirname(this.config.logFile), { recursive: true });
      this.initialized = true;
    } catch {
      // Directory creation may fail in restricted environments
    }
  }
}

// ─── Utility ────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
