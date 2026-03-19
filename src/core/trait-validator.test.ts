import { describe, it, expect } from "vitest";
import { join } from "path";
import {
  loadBaseTraits,
  validateTraits,
  validatePersona,
  patchOutput,
  type BaseTraitsConfig,
} from "./trait-validator.js";

const PERSONAS_DIR = join(process.cwd(), "personas");

describe("Trait-Validator", () => {
  // ─── loadBaseTraits ──────────────────────────────────

  it("lädt base_traits.yaml aus dem personas/kernel Verzeichnis", () => {
    const traits = loadBaseTraits(PERSONAS_DIR);
    expect(traits).not.toBeNull();
    expect(traits!.kernel_abi).toBe(1);
    expect(traits!.traits.handoff).toBeDefined();
    expect(traits!.traits.confidence).toBeDefined();
    expect(traits!.traits.trace).toBeDefined();
  });

  it("gibt null zurück wenn Verzeichnis nicht existiert", () => {
    const traits = loadBaseTraits("/tmp/nonexistent_dir_xyz");
    expect(traits).toBeNull();
  });

  it("handoff ist required, confidence ist optional", () => {
    const traits = loadBaseTraits(PERSONAS_DIR)!;
    expect(traits.traits.handoff.required).toBe(true);
    expect(traits.traits.confidence.required).toBe(false);
    expect(traits.traits.trace.required).toBe(true);
  });

  // ─── validateTraits (Output-Validierung) ─────────────

  const mockTraits: BaseTraitsConfig = {
    kernel_abi: 1,
    traits: {
      handoff: {
        required: true,
        description: "Handoff block",
        format: "",
        position: "end",
        validation: {
          header_pattern: "## Handoff",
          content_pattern: "\\*\\*Next agent needs:\\*\\*",
        },
      },
      confidence: {
        required: false,
        description: "Confidence signal",
        format: "",
        position: "before_handoff",
        validation: {
          content_pattern: "⚠️ LOW_CONFIDENCE:",
        },
      },
      trace: {
        required: true,
        description: "Trace marker",
        format: "",
        position: "last",
        validation: {
          content_pattern: "<!-- trace: .+ -->",
        },
      },
    },
  };

  it("erkennt vollständigen Output", () => {
    const output = `# Analyse

Ergebnis der Analyse.

⚠️ LOW_CONFIDENCE: Unsicher bei Punkt 3.

## Handoff
**Next agent needs:** Die Ergebnisse der Analyse.

<!-- trace: 550e8400-e29b-41d4-a716-446655440000 -->`;

    const results = validateTraits(output, mockTraits);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.found)).toBe(true);
  });

  it("erkennt fehlenden Handoff", () => {
    const output = "Einfacher Output ohne Traits.";
    const results = validateTraits(output, mockTraits);
    const handoff = results.find(r => r.trait === "handoff");
    expect(handoff!.found).toBe(false);
    expect(handoff!.required).toBe(true);
  });

  it("erkennt fehlenden Trace", () => {
    const output = `## Handoff\n**Next agent needs:** Daten.`;
    const results = validateTraits(output, mockTraits);
    const trace = results.find(r => r.trait === "trace");
    expect(trace!.found).toBe(false);
  });

  it("optionaler Confidence-Trait ist ok wenn fehlend", () => {
    const output = `## Handoff\n**Next agent needs:** Daten.\n\n<!-- trace: abc-123 -->`;
    const results = validateTraits(output, mockTraits);
    const confidence = results.find(r => r.trait === "confidence");
    expect(confidence!.found).toBe(false);
    expect(confidence!.required).toBe(false);
  });

  // ─── validatePersona ────────────────────────────────

  it("validiert eine Persona mit Trait-Hints im Prompt", () => {
    const prompt = `Du bist ein Analyst. Am Ende jedes Outputs gibst du einen Handoff-Block
    mit Next agent needs aus. Bei Unsicherheit markierst du LOW_CONFIDENCE.
    Jeder Output enthält einen trace-Marker.`;
    const report = validatePersona("test", prompt, mockTraits);
    expect(report.passed).toBe(true);
    expect(report.results.every(r => r.found)).toBe(true);
  });

  it("erkennt fehlende Traits in Persona-Prompt", () => {
    const prompt = "Du bist ein einfacher Helfer.";
    const report = validatePersona("test", prompt, mockTraits);
    expect(report.passed).toBe(false);
  });

  // ─── patchOutput ─────────────────────────────────────

  it("ergänzt fehlenden Handoff und Trace", () => {
    const output = "Ergebnis der Analyse.\n\nWichtige Erkenntnisse hier.";
    const results = validateTraits(output, mockTraits);
    const patched = patchOutput(output, "test-trace-id", results);
    expect(patched).toContain("## Handoff");
    expect(patched).toContain("**Next agent needs:**");
    expect(patched).toContain("<!-- trace: test-trace-id -->");
  });

  it("patcht nichts wenn alles vorhanden", () => {
    const output = `Ergebnis.\n\n## Handoff\n**Next agent needs:** Daten.\n\n<!-- trace: abc -->`;
    const results = validateTraits(output, mockTraits);
    const patched = patchOutput(output, "abc", results);
    expect(patched).toBe(output);
  });
});
