/**
 * Output Validator – Layer 4: LLM Output Validation.
 *
 * Validates LLM outputs before they are passed downstream or stored.
 * Checks: canary presence, schema conformance, anomaly detection,
 * and data exfiltration attempts.
 */

import { checkCanary, stripCanary, type CanaryToken, type CanaryCheckResult } from "./canary.js";
import type { AuditLogger } from "./audit-logger.js";

// ─── Types ────────────────────────────────────────────────

export interface OutputValidationResult {
  valid: boolean;
  cleanOutput: string;
  issues: OutputIssue[];
  canaryCheck?: CanaryCheckResult;
}

export interface OutputIssue {
  type: "canary_missing" | "canary_modified" | "schema_mismatch" | "anomaly" | "exfiltration_attempt";
  severity: "low" | "medium" | "high" | "critical";
  detail: string;
}

export interface OutputValidatorConfig {
  canaryCheck: boolean;
  schemaValidation: boolean;
  exfiltrationDetection: boolean;
  maxOutputLength: number;
}

// ─── Default Config ───────────────────────────────────────

export const DEFAULT_OUTPUT_CONFIG: OutputValidatorConfig = {
  canaryCheck: true,
  schemaValidation: true,
  exfiltrationDetection: true,
  maxOutputLength: 50_000,
};

// ─── Output Validator ─────────────────────────────────────

export class OutputValidator {
  private config: OutputValidatorConfig;
  private auditLogger?: AuditLogger;

  constructor(config: Partial<OutputValidatorConfig> = {}, auditLogger?: AuditLogger) {
    this.config = { ...DEFAULT_OUTPUT_CONFIG, ...config };
    this.auditLogger = auditLogger;
  }

  /**
   * Validate an LLM output.
   */
  validate(
    output: string,
    canary: CanaryToken | null,
    expectedOutputType?: string,
    pattern?: string,
    traceId?: string,
  ): OutputValidationResult {
    const issues: OutputIssue[] = [];
    let cleanOutput = output;

    // 1. Canary check
    let canaryResult: CanaryCheckResult | undefined;
    if (this.config.canaryCheck && canary) {
      canaryResult = checkCanary(output, canary);

      if (!canaryResult.present) {
        if (canaryResult.modified) {
          issues.push({
            type: "canary_modified",
            severity: "high",
            detail: "Canary token was modified – possible partial prompt override",
          });
        } else {
          issues.push({
            type: "canary_missing",
            severity: "critical",
            detail: "Canary token missing from output – system prompt likely overridden",
          });
        }
        this.auditLogger?.canaryMissing(pattern ?? "unknown", traceId);
      } else {
        cleanOutput = stripCanary(output, canary);
        this.auditLogger?.canaryOk(pattern ?? "unknown", traceId);
      }
    }

    // 2. Schema validation (basic type checking)
    if (this.config.schemaValidation && expectedOutputType) {
      const schemaIssue = this.checkOutputType(cleanOutput, expectedOutputType);
      if (schemaIssue) issues.push(schemaIssue);
    }

    // 3. Exfiltration detection
    if (this.config.exfiltrationDetection) {
      const exfilIssues = this.detectExfiltration(cleanOutput);
      issues.push(...exfilIssues);
    }

    // 4. Length anomaly
    if (cleanOutput.length > this.config.maxOutputLength) {
      issues.push({
        type: "anomaly",
        severity: "medium",
        detail: `Output exceeds max length: ${cleanOutput.length} > ${this.config.maxOutputLength}`,
      });
    }

    return {
      valid: issues.every((i) => i.severity !== "critical"),
      cleanOutput,
      issues,
      canaryCheck: canaryResult,
    };
  }

  // ─── Output Type Checking ─────────────────────────────────

  private checkOutputType(output: string, expectedType: string): OutputIssue | null {
    switch (expectedType.toLowerCase()) {
      case "json": {
        try {
          JSON.parse(output);
        } catch {
          // Try to extract JSON from markdown fences
          const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fenced) {
            try {
              JSON.parse(fenced[1]);
              return null; // JSON found inside fence
            } catch {
              // Fall through to error
            }
          }
          return {
            type: "schema_mismatch",
            severity: "medium",
            detail: `Expected JSON output but got non-JSON text`,
          };
        }
        return null;
      }
      case "markdown":
      case "text":
        return null; // Accept any text
      case "mermaid": {
        if (!/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|gantt|pie|erDiagram)/m.test(output)) {
          return {
            type: "schema_mismatch",
            severity: "low",
            detail: "Expected Mermaid diagram syntax but none detected",
          };
        }
        return null;
      }
      default:
        return null;
    }
  }

  // ─── Exfiltration Detection ───────────────────────────────

  private detectExfiltration(output: string): OutputIssue[] {
    const issues: OutputIssue[] = [];

    // Suspicious URLs (possible data exfiltration via URL encoding)
    const urlPattern = /https?:\/\/[^\s]+\?[^\s]*(?:data|token|key|secret|password|api_key)=[^\s]+/gi;
    const urlMatches = output.match(urlPattern);
    if (urlMatches) {
      issues.push({
        type: "exfiltration_attempt",
        severity: "high",
        detail: `Suspicious URLs with sensitive parameters detected: ${urlMatches.length} matches`,
      });
    }

    // Large Base64 blocks in output (possible encoded data exfil)
    const base64Blocks = output.match(/[A-Za-z0-9+/]{100,}={0,2}/g);
    if (base64Blocks && base64Blocks.length > 0) {
      issues.push({
        type: "exfiltration_attempt",
        severity: "medium",
        detail: `Large base64 blocks in output: ${base64Blocks.length} blocks`,
      });
    }

    // Markdown image/link with data URI
    const dataUriPattern = /!\[.*?\]\(data:.*?\)|<img[^>]+src="data:.*?"/gi;
    if (dataUriPattern.test(output)) {
      issues.push({
        type: "exfiltration_attempt",
        severity: "high",
        detail: "Data URI in markdown image/HTML – possible encoded exfiltration",
      });
    }

    return issues;
  }
}
