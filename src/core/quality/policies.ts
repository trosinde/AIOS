import type { LLMProvider } from "../../agents/provider.js";
import type { QualityPolicy, QualityContext, PolicyResult, Finding, ExecutionContext } from "../../types.js";

/**
 * Default review map: which persona reviews which.
 * Fix definiert – kein Router-Call nötig.
 */
export const DEFAULT_REVIEW_MAP: Record<string, string[]> = {
  developer: ["reviewer"],
  architect: ["security_expert"],
  re: ["architect"],
  security_expert: ["architect"],
  tester: ["developer"],
  reviewer: ["quality_manager"],
  tech_writer: ["reviewer"],
  quality_manager: ["re"],
};

// ─── Policy 1: Self-Check ─────────────────────────────────

export class SelfCheckPolicy implements QualityPolicy {
  name = "self_check";
  description = "LLM-based self-validation of output completeness and correctness";
  appliesAt = "minimal" as const;

  constructor(private provider: LLMProvider) {}

  async evaluate(context: QualityContext): Promise<PolicyResult> {
    const system = `You are a Quality Checker. Evaluate if the following output fully and correctly answers the given task.

Respond ONLY with valid JSON (no markdown fences):
{
  "pass": true/false,
  "findings": [
    {
      "severity": "critical|major|minor|info",
      "category": "completeness|format|consistency|correctness",
      "message": "description of the issue"
    }
  ],
  "rework_hint": "specific feedback for improvement (only if pass=false)"
}`;

    const user = `TASK: ${context.task}

EXPECTED OUTPUT TYPE: ${context.pattern.output_type}

OUTPUT TO CHECK:
${context.output}

Check:
1. Completeness: Was the task fully answered?
2. Format: Does the output match the expected output type?
3. Internal consistency: Are there contradictions?
4. Obvious errors: Factual or logical errors?`;

    const response = await this.provider.complete(system, user, undefined, context.executionContext);

    try {
      const parsed = JSON.parse(extractJson(response.content));
      const findings: Finding[] = (parsed.findings ?? []).map((f: { severity?: string; category?: string; message?: string }) => ({
        severity: f.severity ?? "info",
        category: f.category ?? "unknown",
        message: f.message ?? "",
        source: this.name,
      }));

      return {
        pass: parsed.pass !== false,
        findings,
        action: parsed.pass === false ? "rework" : "continue",
        reworkHint: parsed.rework_hint,
      };
    } catch {
      // If LLM returns unparseable response, pass with info finding
      return {
        pass: true,
        findings: [{
          severity: "info",
          category: "self_check",
          message: "Self-check response could not be parsed, passing by default",
          source: this.name,
        }],
        action: "continue",
      };
    }
  }
}

// ─── Policy 2: Consistency-Check ──────────────────────────

export class ConsistencyCheckPolicy implements QualityPolicy {
  name = "consistency_check";
  description = "Checks output consistency against Knowledge Base decisions, facts, and requirements";
  appliesAt = "standard" as const;

  constructor(private provider: LLMProvider) {}

  async evaluate(context: QualityContext): Promise<PolicyResult> {
    const hasDecisions = context.relevantDecisions && context.relevantDecisions.length > 0;
    const hasFacts = context.relevantFacts && context.relevantFacts.length > 0;
    const hasReqs = context.relevantRequirements && context.relevantRequirements.length > 0;

    // Graceful degradation: skip if KB is empty
    if (!hasDecisions && !hasFacts && !hasReqs) {
      return {
        pass: true,
        findings: [{
          severity: "info",
          category: "consistency",
          message: "Knowledge Base is empty, consistency check skipped",
          source: this.name,
        }],
        action: "continue",
      };
    }

    const decisionsBlock = hasDecisions
      ? `KNOWN DECISIONS:\n${context.relevantDecisions!.map(d => `- ${d.content}`).join("\n")}`
      : "";
    const factsBlock = hasFacts
      ? `KNOWN FACTS:\n${context.relevantFacts!.map(f => `- ${f.content}`).join("\n")}`
      : "";
    const reqsBlock = hasReqs
      ? `ACTIVE REQUIREMENTS:\n${context.relevantRequirements!.map(r => `- ${r.content}`).join("\n")}`
      : "";

    const system = `You are a Consistency Checker. Check if the output is consistent with known decisions, facts, and requirements.

Respond ONLY with valid JSON (no markdown fences):
{
  "pass": true/false,
  "findings": [
    {
      "severity": "critical|major|minor|info",
      "category": "consistency",
      "message": "description of the inconsistency"
    }
  ],
  "rework_hint": "what to fix (only if pass=false)"
}`;

    const user = `OUTPUT TO CHECK:
${context.output}

${decisionsBlock}

${factsBlock}

${reqsBlock}

Check:
1. Does the output contradict any existing decision?
2. Does it ignore known facts?
3. Are referenced requirements correctly represented?`;

    const response = await this.provider.complete(system, user, undefined, context.executionContext);

    try {
      const parsed = JSON.parse(extractJson(response.content));
      const findings: Finding[] = (parsed.findings ?? []).map((f: { severity?: string; category?: string; message?: string }) => ({
        severity: f.severity ?? "info",
        category: f.category ?? "consistency",
        message: f.message ?? "",
        source: this.name,
      }));

      return {
        pass: parsed.pass !== false,
        findings,
        action: parsed.pass === false ? "rework" : "continue",
        reworkHint: parsed.rework_hint,
      };
    } catch {
      return {
        pass: true,
        findings: [{
          severity: "info",
          category: "consistency",
          message: "Consistency check response could not be parsed, passing by default",
          source: this.name,
        }],
        action: "continue",
      };
    }
  }
}

// ─── Policy 3: Peer-Review ────────────────────────────────

export class PeerReviewPolicy implements QualityPolicy {
  name = "peer_review";
  description = "Output is reviewed by a counter-persona from their professional perspective";
  appliesAt = "standard" as const;

  private reviewMap: Record<string, string[]>;

  constructor(
    private provider: LLMProvider,
    private getPersonaPrompt: (personaId: string) => string | undefined,
    reviewMap?: Record<string, string[]>,
  ) {
    this.reviewMap = reviewMap ?? DEFAULT_REVIEW_MAP;
  }

  async evaluate(context: QualityContext): Promise<PolicyResult> {
    const sourcePersonaId = context.persona?.id;
    if (!sourcePersonaId) {
      return {
        pass: true,
        findings: [{
          severity: "info",
          category: "peer_review",
          message: "No persona assigned, peer review skipped",
          source: this.name,
        }],
        action: "continue",
      };
    }

    const reviewerIds = this.reviewMap[sourcePersonaId];
    if (!reviewerIds || reviewerIds.length === 0) {
      return {
        pass: true,
        findings: [{
          severity: "info",
          category: "peer_review",
          message: `No reviewer configured for persona "${sourcePersonaId}", peer review skipped`,
          source: this.name,
        }],
        action: "continue",
      };
    }

    const allFindings: Finding[] = [];
    let worstAction: "continue" | "rework" | "block" = "continue";
    let reworkHint: string | undefined;

    for (const reviewerId of reviewerIds) {
      const reviewerPrompt = this.getPersonaPrompt(reviewerId);
      const systemBase = reviewerPrompt ?? `You are a ${reviewerId} conducting a peer review.`;

      const system = `${systemBase}

You are conducting a peer review. Evaluate the following output from your professional perspective.

Respond ONLY with valid JSON (no markdown fences):
{
  "pass": true/false,
  "findings": [
    {
      "severity": "critical|major|minor|info",
      "category": "string",
      "message": "description"
    }
  ],
  "rework_hint": "specific feedback (only if pass=false)"
}`;

      const user = `ORIGINAL TASK: ${context.task}
CREATED BY: ${sourcePersonaId} (${context.persona?.role ?? "unknown role"})

OUTPUT TO REVIEW:
${context.output}

Categorize your findings:
- CRITICAL: Must be fixed before release
- MAJOR: Should be fixed, but doesn't block usage
- MINOR: Improvement suggestion
- INFO: Observation without action required`;

      const response = await this.provider.complete(system, user, undefined, context.executionContext);

      try {
        const parsed = JSON.parse(extractJson(response.content));
        const findings: Finding[] = (parsed.findings ?? []).map((f: { severity?: string; category?: string; message?: string }) => ({
          severity: f.severity ?? "info",
          category: f.category ?? "peer_review",
          message: f.message ?? "",
          source: `${this.name}:${reviewerId}`,
        }));
        allFindings.push(...findings);

        if (parsed.pass === false) {
          worstAction = "rework";
          reworkHint = parsed.rework_hint ?? reworkHint;
        }
      } catch {
        allFindings.push({
          severity: "info",
          category: "peer_review",
          message: `Peer review by "${reviewerId}" returned unparseable response`,
          source: this.name,
        });
      }
    }

    return {
      pass: worstAction === "continue",
      findings: allFindings,
      action: worstAction,
      reworkHint,
    };
  }
}

// ─── Policy 4: Compliance-Check ───────────────────────────

export class ComplianceCheckPolicy implements QualityPolicy {
  name = "compliance_check";
  description = "Checks output against specific norms and standards (IEC 62443, CRA)";
  appliesAt = "regulated" as const;

  constructor(
    private provider: LLMProvider,
    private standards: string[] = ["iec_62443", "cra"],
  ) {}

  async evaluate(context: QualityContext): Promise<PolicyResult> {
    const system = `You are a Compliance Auditor for ${this.standards.join(", ")}.
Check if the output meets the requirements of the applicable standards.

Respond ONLY with valid JSON (no markdown fences):
{
  "pass": true/false,
  "findings": [
    {
      "severity": "critical|major|minor|info",
      "category": "compliance",
      "message": "description of the compliance gap"
    }
  ],
  "rework_hint": "what to fix (only if pass=false)"
}`;

    const user = `OUTPUT TO CHECK:
${context.output}

STANDARDS: ${this.standards.join(", ")}

Check:
- Are security requirements addressed?
- Are all mandatory artifacts present?
- Is documentation sufficient for an audit?`;

    const response = await this.provider.complete(system, user, undefined, context.executionContext);

    try {
      const parsed = JSON.parse(extractJson(response.content));
      const findings: Finding[] = (parsed.findings ?? []).map((f: { severity?: string; category?: string; message?: string }) => ({
        severity: f.severity ?? "info",
        category: f.category ?? "compliance",
        message: f.message ?? "",
        source: this.name,
      }));

      return {
        pass: parsed.pass !== false,
        findings,
        action: parsed.pass === false ? "rework" : "continue",
        reworkHint: parsed.rework_hint,
      };
    } catch {
      return {
        pass: true,
        findings: [{
          severity: "info",
          category: "compliance",
          message: "Compliance check response could not be parsed, passing by default",
          source: this.name,
        }],
        action: "continue",
      };
    }
  }
}

// ─── Policy 5: Traceability-Check ─────────────────────────

export class TraceabilityCheckPolicy implements QualityPolicy {
  name = "traceability_check";
  description = "Checks requirements coverage — structural check, no LLM needed";
  appliesAt = "regulated" as const;

  constructor(private enforceCoverage: boolean = true) {}

  async evaluate(context: QualityContext): Promise<PolicyResult> {
    const requirements = context.relevantRequirements ?? [];

    if (requirements.length === 0) {
      return {
        pass: true,
        findings: [{
          severity: "info",
          category: "traceability",
          message: "No requirements in Knowledge Base, traceability check skipped",
          source: this.name,
        }],
        action: "continue",
      };
    }

    // Structural check: does the output reference each requirement?
    const findings: Finding[] = [];
    const output = context.output.toLowerCase();

    for (const req of requirements) {
      // Extract requirement ID if present (e.g., "REQ-001")
      const idMatch = req.content.match(/\b(REQ[-_]\w+)/i);
      const reqId = idMatch?.[1] ?? req.id;

      if (!output.includes(reqId.toLowerCase())) {
        findings.push({
          severity: this.enforceCoverage ? "critical" : "major",
          category: "traceability",
          message: `Requirement ${reqId} is not referenced in the output`,
          source: this.name,
        });
      }
    }

    const hasCritical = findings.some(f => f.severity === "critical");
    return {
      pass: !hasCritical,
      findings,
      action: hasCritical ? "block" : "continue",
    };
  }
}

// ─── Policy 6: Quality Gate ───────────────────────────────

export class QualityGatePolicy implements QualityPolicy {
  name = "quality_gate";
  description = "Aggregates findings from all previous policies and decides: pass or block";
  appliesAt = "regulated" as const;

  constructor(
    private blockOn: "critical" | "major" | "minor" = "critical",
    private requireSignOff: string[] = [],
  ) {}

  async evaluate(context: QualityContext): Promise<PolicyResult> {
    const allFindings = context.previousPolicyFindings ?? [];

    const criticals = allFindings.filter(f => f.severity === "critical");
    const majors = allFindings.filter(f => f.severity === "major");
    const minors = allFindings.filter(f => f.severity === "minor");

    const shouldBlock =
      (this.blockOn === "critical" && criticals.length > 0) ||
      (this.blockOn === "major" && (criticals.length + majors.length) > 0) ||
      (this.blockOn === "minor" && (criticals.length + majors.length + minors.length) > 0);

    const auditEntry = {
      id: `AUDIT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now() % 10000}`,
      timestamp: new Date().toISOString(),
      workflow: context.workflowPosition?.workflowId,
      step: context.workflowPosition?.stepId,
      pattern: context.pattern.name,
      persona: context.persona?.id,
      qualityLevel: "regulated" as const,
      inputHash: "",
      outputHash: "",
      policiesExecuted: [],
      totalDurationMs: 0,
      reworkAttempts: 0,
      finalDecision: shouldBlock ? "BLOCKED" as const : "PASSED" as const,
    };

    return {
      pass: !shouldBlock,
      findings: shouldBlock && this.requireSignOff.length > 0
        ? [{
            severity: "critical",
            category: "quality_gate",
            message: `Quality Gate BLOCKED. Requires sign-off from: ${this.requireSignOff.join(", ")}`,
            source: this.name,
          }]
        : [],
      action: shouldBlock ? "block" : "continue",
      auditEntry,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────

/** Extract JSON from a response that may contain markdown fences */
function extractJson(text: string): string {
  // Try to extract from ```json ... ``` blocks
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();

  // Try to find raw JSON object
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }

  return text;
}
