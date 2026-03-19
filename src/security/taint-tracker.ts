/**
 * Taint Tracker – Information Flow Control for AIOS.
 *
 * Every data value flowing through AIOS carries a TaintLabel indicating
 * its origin and trustworthiness. The Policy Engine uses these labels
 * to enforce deterministic security policies (no LLM heuristics).
 *
 * Inspired by FIDES (Microsoft, 2025) dual-lattice taint tracking.
 */

// ─── Taint Labels ─────────────────────────────────────────

export type IntegrityLevel = "trusted" | "derived" | "untrusted";
export type ConfidentialityLevel = "public" | "internal" | "confidential";

export interface TaintLabel {
  integrity: IntegrityLevel;
  confidentiality: ConfidentialityLevel;
  source: string;
  transformations: string[];
}

export interface LabeledValue<T> {
  value: T;
  taint: TaintLabel;
}

// ─── Integrity Ordering ───────────────────────────────────

const INTEGRITY_ORDER: Record<IntegrityLevel, number> = {
  trusted: 2,
  derived: 1,
  untrusted: 0,
};

const CONFIDENTIALITY_ORDER: Record<ConfidentialityLevel, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
};

// ─── Taint Operations ─────────────────────────────────────

/**
 * Create a taint label for user input (always untrusted).
 */
export function userInputTaint(source: string = "user_input"): TaintLabel {
  return {
    integrity: "untrusted",
    confidentiality: "public",
    source,
    transformations: [],
  };
}

/**
 * Create a taint label for system/kernel data (always trusted).
 */
export function trustedTaint(source: string): TaintLabel {
  return {
    integrity: "trusted",
    confidentiality: "internal",
    source,
    transformations: [],
  };
}

/**
 * Create a taint label for LLM-derived output.
 * The integrity is the minimum of all input integrities.
 */
export function derivedTaint(
  inputs: TaintLabel[],
  transformation: string,
): TaintLabel {
  if (inputs.length === 0) {
    return { integrity: "untrusted", confidentiality: "public", source: "unknown", transformations: [transformation] };
  }

  // Conservative merge: take minimum integrity, maximum confidentiality
  const minIntegrity = mergeIntegrity(inputs.map((t) => t.integrity));
  const maxConfidentiality = mergeConfidentiality(inputs.map((t) => t.confidentiality));

  // If all inputs are trusted, output is derived (LLM processing loses trust)
  const integrity: IntegrityLevel =
    minIntegrity === "trusted" ? "derived" : minIntegrity;

  return {
    integrity,
    confidentiality: maxConfidentiality,
    source: inputs.map((t) => t.source).join("+"),
    transformations: [
      ...inputs.flatMap((t) => t.transformations),
      transformation,
    ],
  };
}

/**
 * Merge multiple integrity levels: returns the minimum (most conservative).
 */
export function mergeIntegrity(levels: IntegrityLevel[]): IntegrityLevel {
  if (levels.length === 0) return "untrusted";
  let min = INTEGRITY_ORDER[levels[0]];
  for (let i = 1; i < levels.length; i++) {
    const val = INTEGRITY_ORDER[levels[i]];
    if (val < min) min = val;
  }
  for (const [key, val] of Object.entries(INTEGRITY_ORDER)) {
    if (val === min) return key as IntegrityLevel;
  }
  return "untrusted";
}

/**
 * Merge multiple confidentiality levels: returns the maximum (most restrictive).
 */
export function mergeConfidentiality(
  levels: ConfidentialityLevel[],
): ConfidentialityLevel {
  if (levels.length === 0) return "public";
  let max = CONFIDENTIALITY_ORDER[levels[0]];
  for (let i = 1; i < levels.length; i++) {
    const val = CONFIDENTIALITY_ORDER[levels[i]];
    if (val > max) max = val;
  }
  for (const [key, val] of Object.entries(CONFIDENTIALITY_ORDER)) {
    if (val === max) return key as ConfidentialityLevel;
  }
  return "public";
}

/**
 * Check if a taint label meets a minimum integrity requirement.
 */
export function meetsIntegrity(
  label: TaintLabel,
  required: IntegrityLevel,
): boolean {
  return INTEGRITY_ORDER[label.integrity] >= INTEGRITY_ORDER[required];
}

/**
 * Wrap a value with a taint label.
 */
export function label<T>(value: T, taint: TaintLabel): LabeledValue<T> {
  return { value, taint };
}
