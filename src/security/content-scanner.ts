/**
 * Content Scanner – Memory Poisoning Detection.
 *
 * Detects prompt injection payloads in content destined for the
 * KnowledgeBus. Complements the InputGuard (which scans user input
 * at the workflow boundary) by targeting patterns specific to
 * *persistent* memory poisoning — self-replication instructions,
 * temporal triggers, and role overrides embedded in declarative text.
 *
 * IMPORTANT: This is heuristic, regex-based detection. False negatives
 * are expected. This scanner is ONE layer in defense-in-depth, not a
 * standalone solution. Do not rely on it as the sole barrier against
 * knowledge poisoning.
 *
 * Part of the H2 mitigation (AIOS Memory als Persistenz-Vektor).
 */

// ─── Types ────────────────────────────────────────────────

export type ContentFlag =
  | "instruction_pattern"   // "ignore previous", "you must", "execute"
  | "role_override"         // "you are now", "from now on"
  | "system_boundary"       // <system>, </instruction>, XML tag injection
  | "meta_instruction"      // "when recalled", "on next run", "always remember"
  | "self_replication"      // "store this again", "persist this"
  | "encoding_obfuscation"; // base64/rot13-encoded instructions

export interface ContentScanResult {
  suspicious: boolean;
  score: number;          // 0.0 (clean) to 1.0 (definite injection)
  flags: ContentFlag[];
  details: string[];
}

interface ScanPattern {
  name: string;
  pattern: RegExp;
  severity: number;
  flag: ContentFlag;
}

// ─── Scan Patterns ────────────────────────────────────────

/**
 * Memory-poisoning-specific patterns. These go beyond what InputGuard
 * detects because they target the *persistence* vector: instructions
 * designed to survive in KB and re-trigger on recall.
 */
const MEMORY_POISONING_PATTERNS: ScanPattern[] = [
  // ── Meta-instructions (temporal triggers) ──
  {
    name: "when_recalled",
    pattern: /when\s+(you\s+)?(read|recall|retrieve|load|see)\s+this/i,
    severity: 0.9,
    flag: "meta_instruction",
  },
  {
    name: "on_next_run",
    pattern: /on\s+(the\s+)?(next|every|each|future)\s+(run|execution|invocation|call)/i,
    severity: 0.9,
    flag: "meta_instruction",
  },
  {
    name: "always_remember",
    pattern: /always\s+(remember|keep|maintain|ensure|follow|execute|do)\s+(to|that|this)/i,
    severity: 0.7,
    flag: "meta_instruction",
  },
  {
    name: "from_now_on",
    pattern: /from\s+now\s+on[,]?\s+(you\s+)?(will|should|must|shall|are|need)/i,
    severity: 0.85,
    flag: "meta_instruction",
  },
  {
    name: "whenever_triggered",
    pattern: /whenever\s+(you|this|the\s+agent)\s+(are|is|get|start|begin)/i,
    severity: 0.8,
    flag: "meta_instruction",
  },

  // ── Self-replication ──
  {
    name: "store_this_again",
    pattern: /store\s+this\s+(again|back|entry|fact|item)/i,
    severity: 0.95,
    flag: "self_replication",
  },
  {
    name: "persist_instruction",
    pattern: /(persist|save|write|publish)\s+(this|the\s+following)\s+(to|in|into)\s+(memory|knowledge|kb)/i,
    severity: 0.9,
    flag: "self_replication",
  },
  {
    name: "must_be_remembered",
    pattern: /this\s+(must|should|needs?\s+to)\s+be\s+(remembered|stored|persisted|saved)/i,
    severity: 0.85,
    flag: "self_replication",
  },

  // ── Instruction patterns in declarative context ──
  {
    name: "execute_command",
    pattern: /(execute|run|invoke|call)\s+(the\s+following|this)\s+(command|script|code|function)/i,
    severity: 0.85,
    flag: "instruction_pattern",
  },
  {
    name: "you_must",
    pattern: /you\s+(must|should|shall|need\s+to|have\s+to)\s+(always|never|immediately)/i,
    severity: 0.7,
    flag: "instruction_pattern",
  },
  {
    name: "ignore_instructions",
    pattern: /ignore\s+(all\s+)?(previous|prior|above|other|safety)\s+(instructions|rules|guidelines|constraints)/i,
    severity: 0.95,
    flag: "instruction_pattern",
  },
  {
    name: "override_behavior",
    pattern: /(override|bypass|disable|circumvent)\s+(your|the|all|any)\s+(rules|restrictions|limitations|safety|guardrails)/i,
    severity: 0.95,
    flag: "instruction_pattern",
  },

  // ── Role override ──
  {
    name: "you_are_now",
    pattern: /you\s+are\s+now\s+(a|an|the|no\s+longer)/i,
    severity: 0.8,
    flag: "role_override",
  },
  {
    name: "new_identity",
    pattern: /your\s+(new\s+)?(role|identity|purpose|name|persona)\s+(is|:|=)/i,
    severity: 0.85,
    flag: "role_override",
  },
  {
    name: "pretend_to_be",
    pattern: /(pretend|act|behave)\s+(you\s+are|to\s+be|as\s+if\s+you)/i,
    severity: 0.7,
    flag: "role_override",
  },

  // ── System boundary injection ──
  {
    name: "xml_system_tags",
    pattern: /<\/?\s*(system|instruction|prompt|assistant|user|tool_call|context)\s*>/i,
    severity: 0.85,
    flag: "system_boundary",
  },
  {
    name: "markdown_system_header",
    pattern: /^#{1,3}\s*(SYSTEM|INSTRUCTION|PROMPT|IDENTITY|PURPOSE|RULES)\s*$/m,
    severity: 0.75,
    flag: "system_boundary",
  },

  // ── Encoding obfuscation ──
  {
    name: "base64_block",
    pattern: /[A-Za-z0-9+/]{40,}={0,2}/,
    severity: 0.5,  // Lower — legitimate content can contain base64
    flag: "encoding_obfuscation",
  },
  {
    name: "rot13_reference",
    pattern: /\brot13\b/i,
    severity: 0.5,
    flag: "encoding_obfuscation",
  },
  {
    name: "hex_sequences",
    pattern: /(?:0x[0-9a-f]{2}\s*){6,}|(?:\\x[0-9a-f]{2}){6,}/i,
    severity: 0.6,
    flag: "encoding_obfuscation",
  },
];

// ─── Content Scanner ──────────────────────────────────────

export class ContentScanner {
  private readonly patterns: readonly ScanPattern[];

  constructor(extraPatterns?: ScanPattern[]) {
    this.patterns = extraPatterns
      ? [...MEMORY_POISONING_PATTERNS, ...extraPatterns]
      : MEMORY_POISONING_PATTERNS;
  }

  /**
   * Scan content destined for the KnowledgeBus.
   *
   * Returns a result with a score between 0.0 (clean) and 1.0
   * (definite injection). The `suspicious` flag is true when the
   * score exceeds the threshold (0.7).
   */
  scan(content: string, threshold = 0.7): ContentScanResult {
    const flags: ContentFlag[] = [];
    const details: string[] = [];
    let score = 0;

    // Normalize: NFKC + strip zero-width characters
    const normalized = content
      .normalize("NFKC")
      .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, "");

    for (const pat of this.patterns) {
      if (pat.pattern.test(normalized)) {
        if (!flags.includes(pat.flag)) flags.push(pat.flag);
        // Extract the match for the detail string
        const match = normalized.match(pat.pattern);
        const snippet = match?.[0]?.slice(0, 60) ?? "";
        details.push(`${pat.name}: "${snippet}"`);
        score = Math.max(score, pat.severity);
      }
    }

    // Structural heuristic: high density of imperative verbs in
    // content that should be declarative (facts, decisions).
    // Count 2nd-person imperative phrases.
    const imperativeCount = countImperatives(normalized);
    const wordCount = normalized.split(/\s+/).length;
    if (wordCount > 10 && imperativeCount / wordCount > 0.15) {
      if (!flags.includes("instruction_pattern")) flags.push("instruction_pattern");
      details.push(`imperative_density: ${imperativeCount}/${wordCount} words (${(imperativeCount / wordCount * 100).toFixed(0)}%)`);
      score = Math.max(score, 0.6);
    }

    return {
      suspicious: score >= threshold,
      score: Math.min(score, 1.0),
      flags,
      details,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Count imperative/2nd-person phrases that are unusual in
 * declarative knowledge content (facts, decisions, findings).
 */
function countImperatives(text: string): number {
  const imperativePatterns = [
    /\byou\s+(must|should|shall|will|need|have\s+to)\b/gi,
    /\b(do|don't|never|always)\s+\w/gi,
    /\b(execute|run|invoke|perform|ensure|make\s+sure)\b/gi,
  ];
  let count = 0;
  for (const pat of imperativePatterns) {
    const matches = text.match(pat);
    if (matches) count += matches.length;
  }
  return count;
}
