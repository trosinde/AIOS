/**
 * Canary Token System – detects system prompt override.
 *
 * A random canary token is injected into the system prompt.
 * If the LLM's output does not contain the canary, it indicates
 * the system prompt was likely overridden by prompt injection.
 */

import { createHash, randomBytes } from "crypto";

// ─── Types ────────────────────────────────────────────────

export interface CanaryToken {
  /** The full canary string to inject in the system prompt */
  instruction: string;
  /** The expected token that must appear in output */
  token: string;
}

export interface CanaryCheckResult {
  present: boolean;
  token: string;
  modified: boolean;
}

// ─── Canary Generation ────────────────────────────────────

/**
 * Generate a unique canary token for a single LLM call.
 * Uses random bytes + trace context for uniqueness.
 */
export function generateCanary(traceId?: string): CanaryToken {
  const seed = randomBytes(8).toString("hex");
  const hash = createHash("sha256")
    .update(seed + (traceId ?? ""))
    .digest("hex")
    .slice(0, 12);

  const token = `CANARY-${hash}`;

  const instruction = [
    "",
    "## INTEGRITY CHECK",
    `You MUST include the following token at the very end of your response: ${token}`,
    "This is a mandatory integrity check. Do not omit or modify this token.",
    "",
  ].join("\n");

  return { instruction, token };
}

// ─── Canary Verification ──────────────────────────────────

/**
 * Check if the canary token is present in the LLM output.
 */
export function checkCanary(
  output: string,
  canary: CanaryToken,
): CanaryCheckResult {
  const present = output.includes(canary.token);

  // Check if a modified canary is present (partial match)
  const modified = !present && output.includes("CANARY-");

  return { present, token: canary.token, modified };
}

/**
 * Strip the canary token from output before returning to the user.
 */
export function stripCanary(output: string, canary: CanaryToken): string {
  return output.replace(canary.token, "").trimEnd();
}
