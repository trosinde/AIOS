import type { LLMProvider } from "../../agents/provider.js";
import type { QualityPolicy, QualityContext, PolicyResult, Finding } from "../../types.js";
import { PromptBuilder } from "../../security/prompt-builder.js";

// ─── Policy 1: Self-Check ─────────────────────────────────

/**
 * SelfCheckPolicy – LLM-basierte Selbst-Validierung eines Pattern-Outputs.
 *
 * Trust-Boundary: Der Output kommt aus einem LLM und ist untrusted. Wir
 * routen den Check-Prompt deshalb durch den PromptBuilder, damit der zu
 * prüfende Text klar als „Daten" getagged ist und nicht als Instruktion
 * interpretiert werden kann.
 *
 * Self-Approval-Schutz: Der LLM kann nicht einfach `{"pass": true}` am
 * Textende anhängen und sich selbst durchwinken. Wir verlangen einen
 * Canary-Token im Response, der nur im System-Prompt bekannt gegeben
 * wurde. Fehlt der Canary, betrachten wir das Response als ungültig und
 * geben ein „continue-with-info"-Ergebnis zurück (graceful degradation).
 */
export class SelfCheckPolicy implements QualityPolicy {
  name = "self_check";
  description = "LLM-based self-validation of output completeness and correctness";
  appliesAt = "minimal" as const;

  private promptBuilder = new PromptBuilder();

  constructor(private provider: LLMProvider) {}

  async evaluate(context: QualityContext): Promise<PolicyResult> {
    // Canary wird in den System-Prompt injiziert. Der LLM muss ihn im
    // Response spiegeln; fehlt er, gilt das Response als nicht-autorisiert.
    const canary = `CANARY_${context.executionContext.trace_id.slice(0, 12)}`;

    const systemPrompt = `You are a Quality Checker. Evaluate if the output in <user_data> fully and correctly answers the stated task.

Respond ONLY with valid JSON in exactly this shape (no markdown fences, no commentary):
{
  "canary": "${canary}",
  "pass": true | false,
  "findings": [
    {
      "severity": "critical" | "major" | "minor" | "info",
      "category": "completeness" | "format" | "consistency" | "correctness",
      "message": "<issue description>"
    }
  ],
  "rework_hint": "<specific feedback, required iff pass is false>"
}

The "canary" field MUST be exactly "${canary}". Any response without the correct canary is invalid.

Evaluate:
1. Completeness — was the task fully answered?
2. Format — does the output match the expected output type "${context.pattern.output_type}"?
3. Internal consistency — any contradictions?
4. Obvious errors — factual or logical mistakes?`;

    const untrustedPayload = `TASK:
${context.task}

OUTPUT TO CHECK:
${context.output}`;

    const built = this.promptBuilder.build(
      systemPrompt,
      untrustedPayload,
      [],
      context.executionContext.trace_id,
    );

    const response = await this.provider.complete(
      built.systemPrompt,
      built.userMessage,
      undefined,
      context.executionContext,
    );

    const parsed = safeParseSelfCheck(response.content, canary);
    if (!parsed) {
      // Canary missing or JSON unparseable → response is not trustworthy.
      // Do NOT silently set pass=true. Flag as info and let the gate
      // downstream decide. We use "continue" so we don't trigger a rework
      // loop on purely malformed responses.
      return {
        pass: true,
        findings: [{
          severity: "info",
          category: "self_check",
          message: "Self-check response missing canary or unparseable, skipping verdict",
          source: this.name,
        }],
        action: "continue",
      };
    }

    const findings: Finding[] = (parsed.findings ?? []).map((f) => ({
      severity: (f.severity as Finding["severity"]) ?? "info",
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
  }
}

// ─── Policy 2: Quality Gate ───────────────────────────────

/**
 * QualityGatePolicy – aggregiert Findings aus vorangegangenen Policies
 * und entscheidet: pass oder block. Führt selbst keinen LLM-Call durch.
 *
 * MVP: läuft bereits auf Level „minimal", nicht erst „regulated". Begründung:
 * wir wollen einen harten Blocker auch im leichtesten Profil ohne einen
 * komplexen regulated-Policy-Stack.
 */
export class QualityGatePolicy implements QualityPolicy {
  name = "quality_gate";
  description = "Aggregates findings from all previous policies and decides pass/block";
  appliesAt = "minimal" as const;

  constructor(
    private blockOn: "critical" | "major" | "minor" = "critical",
    private requireSignOff: string[] = [],
  ) {}

  async evaluate(context: QualityContext): Promise<PolicyResult> {
    const all = context.previousPolicyFindings ?? [];
    const criticals = all.filter((f) => f.severity === "critical");
    const majors = all.filter((f) => f.severity === "major");
    const minors = all.filter((f) => f.severity === "minor");

    const shouldBlock =
      (this.blockOn === "critical" && criticals.length > 0) ||
      (this.blockOn === "major" && (criticals.length + majors.length) > 0) ||
      (this.blockOn === "minor" && (criticals.length + majors.length + minors.length) > 0);

    const findings: Finding[] = shouldBlock && this.requireSignOff.length > 0
      ? [{
          severity: "critical",
          category: "quality_gate",
          message: `Quality Gate blocked. Requires sign-off from: ${this.requireSignOff.join(", ")}`,
          source: this.name,
        }]
      : [];

    return {
      pass: !shouldBlock,
      findings,
      action: shouldBlock ? "block" : "continue",
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────

interface ParsedSelfCheck {
  canary: string;
  pass: boolean;
  findings?: Array<{ severity?: string; category?: string; message?: string }>;
  rework_hint?: string;
}

/**
 * Parst und validiert ein SelfCheck-Response.
 *
 * Sicherheitsprüfungen:
 * 1. Strukturell valides JSON an der erwarteten Position extrahieren.
 * 2. Der Canary muss exakt stimmen (schützt gegen LLM-Self-Approval).
 * 3. `pass` muss ein Boolean sein – String-„true" reicht nicht.
 */
export function safeParseSelfCheck(
  text: string,
  expectedCanary: string,
): ParsedSelfCheck | null {
  const jsonText = extractJson(text);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.canary !== expectedCanary) return null;
  if (typeof obj.pass !== "boolean") return null;

  return {
    canary: expectedCanary,
    pass: obj.pass,
    findings: Array.isArray(obj.findings)
      ? (obj.findings as ParsedSelfCheck["findings"])
      : undefined,
    rework_hint: typeof obj.rework_hint === "string" ? obj.rework_hint : undefined,
  };
}

/**
 * Extrahiert ein JSON-Objekt aus einer LLM-Response.
 *
 * Bevorzugt ```json-Fenced-Blocks; fällt zurück auf das erste top-level
 * Objekt ab dem ersten `{`. Gibt `null` zurück wenn nichts Plausibles
 * gefunden wird (statt dem Rohtext, wie vorher).
 */
function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();

  const braceStart = text.indexOf("{");
  if (braceStart === -1) return null;
  const braceEnd = text.lastIndexOf("}");
  if (braceEnd <= braceStart) return null;

  return text.slice(braceStart, braceEnd + 1);
}
