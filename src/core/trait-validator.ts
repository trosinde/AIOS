import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "yaml";

// ─── Types ──────────────────────────────────────────────

export interface TraitDefinition {
  required: boolean;
  description: string;
  format: string;
  position: "end" | "before_handoff" | "last";
  validation: {
    header_pattern?: string;
    content_pattern?: string;
  };
}

export interface BaseTraitsConfig {
  kernel_abi: number;
  traits: Record<string, TraitDefinition>;
}

export interface TraitValidationResult {
  trait: string;
  required: boolean;
  found: boolean;
  message: string;
}

export interface ValidationReport {
  persona: string;
  results: TraitValidationResult[];
  passed: boolean;
}

// ─── Loader ─────────────────────────────────────────────

export function loadBaseTraits(personasDir: string): BaseTraitsConfig | null {
  const traitsPath = join(personasDir, "kernel", "base_traits.yaml");
  if (!existsSync(traitsPath)) return null;

  const raw = readFileSync(traitsPath, "utf-8");
  return parse(raw) as BaseTraitsConfig;
}

// ─── Validator ──────────────────────────────────────────

/**
 * Validiert ob ein LLM-Output die Base Traits enthält.
 * Wird nach jedem Persona-Aufruf verwendet.
 */
export function validateTraits(
  output: string,
  traits: BaseTraitsConfig
): TraitValidationResult[] {
  const results: TraitValidationResult[] = [];

  for (const [name, trait] of Object.entries(traits.traits)) {
    let found = true;

    if (trait.validation.header_pattern) {
      if (!output.includes(trait.validation.header_pattern)) {
        found = false;
      }
    }

    if (trait.validation.content_pattern) {
      const regex = new RegExp(trait.validation.content_pattern);
      if (!regex.test(output)) {
        found = false;
      }
    }

    results.push({
      trait: name,
      required: trait.required,
      found,
      message: found
        ? `${name}: vorhanden`
        : trait.required
          ? `${name}: FEHLT (required)`
          : `${name}: nicht vorhanden (optional)`,
    });
  }

  return results;
}

/**
 * Validiert eine Persona-Definition gegen die Base Traits.
 * Prüft ob der system_prompt Hinweise auf Trait-Implementierung enthält.
 */
export function validatePersona(
  personaId: string,
  systemPrompt: string,
  traits: BaseTraitsConfig
): ValidationReport {
  const results: TraitValidationResult[] = [];

  for (const [name, trait] of Object.entries(traits.traits)) {
    // Prüfe ob der system_prompt Hinweise auf den Trait enthält
    const hints = getTraitHints(name);
    const found = hints.some(hint =>
      systemPrompt.toLowerCase().includes(hint.toLowerCase())
    );

    results.push({
      trait: name,
      required: trait.required,
      found,
      message: found
        ? `${name}: Hinweise im system_prompt gefunden`
        : trait.required
          ? `${name}: Keine Hinweise im system_prompt (empfohlen: Instruktion hinzufügen)`
          : `${name}: Nicht referenziert (optional, nur runtime-relevant)`,
    });
  }

  const passed = results
    .filter(r => r.required)
    .every(r => r.found);

  return { persona: personaId, results, passed };
}

/**
 * Ergänzt einen LLM-Output um fehlende required Traits (graceful degradation).
 */
export function patchOutput(
  output: string,
  traceId: string,
  traitResults: TraitValidationResult[]
): string {
  let patched = output;

  const handoffMissing = traitResults.find(r => r.trait === "handoff" && !r.found);
  if (handoffMissing) {
    // Synthetischen Handoff aus letztem Absatz generieren
    const lastParagraph = output.trim().split("\n\n").pop() ?? "";
    patched += `\n\n## Handoff\n**Next agent needs:** ${lastParagraph.slice(0, 200)}`;
  }

  const traceMissing = traitResults.find(r => r.trait === "trace" && !r.found);
  if (traceMissing) {
    patched += `\n\n<!-- trace: ${traceId} -->`;
  }

  return patched;
}

// ─── Helpers ────────────────────────────────────────────

function getTraitHints(traitName: string): string[] {
  switch (traitName) {
    case "handoff":
      return ["handoff", "next agent", "übergabe", "next step needs"];
    case "confidence":
      return ["confidence", "konfidenz", "LOW_CONFIDENCE", "unsicher"];
    case "trace":
      return ["trace", "trace_id", "rückverfolgbar"];
    default:
      return [traitName];
  }
}
