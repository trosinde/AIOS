/**
 * Input Guard – Layer 1: Input Boundary Protection.
 *
 * Catches obvious injection attempts BEFORE they reach an LLM.
 * Uses Unicode normalization, regex pattern detection, encoding detection,
 * and fuzzy keyword matching (typoglycemia-resistant).
 *
 * Reference: OWASP LLM Prompt Injection Prevention Cheat Sheet
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import YAML from "yaml";

// ─── Types ────────────────────────────────────────────────

export type InjectionFlag =
  | "pattern_match"
  | "encoding_detected"
  | "typoglycemia"
  | "role_override"
  | "instruction_boundary"
  | "excessive_formatting"
  | "semantic_anomaly";

export interface InputGuardResult {
  safe: boolean;
  score: number; // 0.0 (clean) to 1.0 (definite injection)
  flags: InjectionFlag[];
  details: string[];
  normalized: string;
}

export interface InputGuardConfig {
  enabled: boolean;
  threshold: number;
  mode: "warn" | "block";
  patternsFile?: string;
  normalizeUnicode: boolean;
  detectEncoding: boolean;
  fuzzyMatching: boolean;
}

interface InjectionPattern {
  name: string;
  pattern: string;
  severity: number; // 0.0 - 1.0
  flag: InjectionFlag;
  description?: string;
}

// ─── Default Config ───────────────────────────────────────

export const DEFAULT_GUARD_CONFIG: InputGuardConfig = {
  enabled: true,
  threshold: 0.7,
  mode: "block",
  normalizeUnicode: true,
  detectEncoding: true,
  fuzzyMatching: true,
};

// ─── Built-in Patterns ────────────────────────────────────

const BUILTIN_PATTERNS: InjectionPattern[] = [
  // Direct injection attempts
  { name: "ignore_instructions", pattern: "ignore\\s+(all\\s+)?(previous|prior|above|preceding)\\s+(instructions|prompts|rules|directives)", severity: 0.9, flag: "pattern_match" },
  { name: "new_instructions", pattern: "(new|updated|revised|override)\\s+instructions?\\s*:", severity: 0.8, flag: "pattern_match" },
  { name: "system_prompt_override", pattern: "(system\\s*prompt|system\\s*message)\\s*[:=]", severity: 0.9, flag: "pattern_match" },
  { name: "developer_mode", pattern: "(developer|debug|admin|god|sudo|root)\\s+mode", severity: 0.8, flag: "pattern_match" },
  { name: "jailbreak_dan", pattern: "\\b(DAN|do\\s+anything\\s+now)\\b", severity: 0.85, flag: "pattern_match" },
  { name: "pretend_to_be", pattern: "(pretend|act|behave|imagine)\\s+(you\\s+are|to\\s+be|as\\s+if)", severity: 0.6, flag: "pattern_match" },
  { name: "forget_everything", pattern: "(forget|disregard|discard)\\s+(everything|all|anything)\\s+(you|that|above)", severity: 0.9, flag: "pattern_match" },
  { name: "you_are_now", pattern: "you\\s+are\\s+now\\s+(a|an|the)", severity: 0.7, flag: "role_override" },
  { name: "roleplay_override", pattern: "from\\s+now\\s+on[,]?\\s+you\\s+(will|should|must|are)", severity: 0.8, flag: "role_override" },

  // Instruction boundary attacks
  { name: "xml_tag_injection", pattern: "<\\/?\\s*(system|instruction|prompt|assistant|user|context|tool_call)\\s*>", severity: 0.85, flag: "instruction_boundary" },
  { name: "markdown_system", pattern: "^#{1,3}\\s*(SYSTEM|INSTRUCTION|PROMPT|IDENTITY|PURPOSE|RULES)", severity: 0.7, flag: "instruction_boundary" },
  { name: "triple_dash_boundary", pattern: "^---+\\s*$", severity: 0.3, flag: "instruction_boundary" },
  { name: "output_format_override", pattern: "(output\\s+format|response\\s+format)\\s*[:=]", severity: 0.5, flag: "instruction_boundary" },

  // Exfiltration attempts
  { name: "reveal_prompt", pattern: "(reveal|show|display|print|output|repeat|echo)\\s+(your|the|system)\\s+(prompt|instructions|rules|system\\s+message)", severity: 0.8, flag: "pattern_match" },
  { name: "what_instructions", pattern: "what\\s+(are|were)\\s+your\\s+(instructions|rules|directives|system\\s+prompt)", severity: 0.7, flag: "pattern_match" },
];

// ─── Fuzzy Keyword Patterns (Typoglycemia-resistant) ──────

const DANGEROUS_KEYWORDS = [
  "ignore", "instructions", "system", "prompt", "override",
  "jailbreak", "developer", "bypass", "disable", "pretend",
  "roleplay", "forget", "disregard",
];

// ─── Input Guard ──────────────────────────────────────────

export class InputGuard {
  private config: InputGuardConfig;
  private customPatterns: InjectionPattern[] = [];

  constructor(config: Partial<InputGuardConfig> = {}) {
    this.config = { ...DEFAULT_GUARD_CONFIG, ...config };
    if (this.config.patternsFile) {
      this.loadCustomPatterns(this.config.patternsFile);
    }
  }

  /**
   * Analyze input for potential prompt injection.
   */
  analyze(input: string): InputGuardResult {
    if (!this.config.enabled) {
      return { safe: true, score: 0, flags: [], details: [], normalized: input };
    }

    const flags: InjectionFlag[] = [];
    const details: string[] = [];
    let score = 0;

    // Step 1: Normalize
    const normalized = this.config.normalizeUnicode
      ? this.normalize(input)
      : input;

    // Step 2: Encoding detection
    if (this.config.detectEncoding) {
      const encodingResult = this.detectEncoding(normalized);
      if (encodingResult.detected) {
        flags.push("encoding_detected");
        details.push(...encodingResult.details);
        score = Math.max(score, encodingResult.score);
      }
    }

    // Step 3: Pattern matching
    const allPatterns = [...BUILTIN_PATTERNS, ...this.customPatterns];
    for (const pattern of allPatterns) {
      try {
        const regex = new RegExp(pattern.pattern, "gim");
        const matches = normalized.match(regex);
        if (matches) {
          if (!flags.includes(pattern.flag)) flags.push(pattern.flag);
          details.push(`${pattern.name}: "${matches[0].slice(0, 50)}"`);
          score = Math.max(score, pattern.severity);
        }
      } catch {
        // Skip invalid regex patterns
      }
    }

    // Step 4: Fuzzy keyword matching
    if (this.config.fuzzyMatching) {
      const fuzzyResult = this.fuzzyKeywordCheck(normalized);
      if (fuzzyResult.detected) {
        if (!flags.includes("typoglycemia")) flags.push("typoglycemia");
        details.push(...fuzzyResult.details);
        score = Math.max(score, fuzzyResult.score);
      }
    }

    // Step 5: Structural analysis
    const structResult = this.structuralAnalysis(normalized);
    if (structResult.detected) {
      if (!flags.includes("excessive_formatting")) flags.push("excessive_formatting");
      details.push(...structResult.details);
      score = Math.max(score, structResult.score);
    }

    return {
      safe: score < this.config.threshold,
      score: Math.min(score, 1.0),
      flags,
      details,
      normalized,
    };
  }

  // ─── Normalization ────────────────────────────────────────

  /**
   * Unicode NFKC normalization + strip invisible characters + resolve homoglyphs.
   */
  normalize(input: string): string {
    let text = input;

    // NFKC normalization (resolves compatibility decomposition)
    text = text.normalize("NFKC");

    // Remove zero-width characters and other invisibles
    text = text.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, "");

    // Resolve common homoglyphs
    const homoglyphs: Record<string, string> = {
      "\u0410": "A", "\u0412": "B", "\u0421": "C", "\u0415": "E",
      "\u041D": "H", "\u041A": "K", "\u041C": "M", "\u041E": "O",
      "\u0420": "P", "\u0422": "T", "\u0425": "X",
      "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p",
      "\u0441": "c", "\u0443": "y", "\u0445": "x",
      "\uFF21": "A", "\uFF22": "B", "\uFF23": "C", // Fullwidth Latin
    };
    for (const [from, to] of Object.entries(homoglyphs)) {
      text = text.replaceAll(from, to);
    }

    return text;
  }

  // ─── Encoding Detection ───────────────────────────────────

  private detectEncoding(input: string): { detected: boolean; details: string[]; score: number } {
    const details: string[] = [];
    let score = 0;

    // Base64 detection (blocks of 20+ base64 chars)
    const base64Pattern = /[A-Za-z0-9+/]{20,}={0,2}/g;
    const base64Matches = input.match(base64Pattern);
    if (base64Matches) {
      for (const match of base64Matches) {
        try {
          const decoded = Buffer.from(match, "base64").toString("utf-8");
          // Check if decoded content looks like text (not binary)
          if (/^[\x20-\x7E\s]{4,}$/.test(decoded)) {
            details.push(`base64_block: "${match.slice(0, 30)}..." → "${decoded.slice(0, 30)}"`);
            score = Math.max(score, 0.7);
          }
        } catch {
          // Not valid base64
        }
      }
    }

    // Hex encoding detection
    const hexPattern = /(?:0x[0-9a-f]{2}\s*){4,}|(?:\\x[0-9a-f]{2}){4,}/gi;
    if (hexPattern.test(input)) {
      details.push("hex_encoding_detected");
      score = Math.max(score, 0.6);
    }

    // ROT13 marker detection
    if (/\brot13\b/i.test(input)) {
      details.push("rot13_reference_detected");
      score = Math.max(score, 0.5);
    }

    return { detected: details.length > 0, details, score };
  }

  // ─── Fuzzy Keyword Matching ───────────────────────────────

  private fuzzyKeywordCheck(input: string): { detected: boolean; details: string[]; score: number } {
    const details: string[] = [];
    let score = 0;
    const words = input.toLowerCase().split(/\s+/);

    for (const word of words) {
      if (word.length < 4) continue;
      for (const keyword of DANGEROUS_KEYWORDS) {
        if (word === keyword) continue; // Exact match handled by regex
        const distance = this.levenshtein(word, keyword);
        const maxDist = Math.max(1, Math.floor(keyword.length / 4));
        if (distance > 0 && distance <= maxDist) {
          details.push(`fuzzy_match: "${word}" ~ "${keyword}" (dist=${distance})`);
          score = Math.max(score, 0.5);
        }
      }
    }

    return { detected: details.length > 0, details, score };
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    return dp[m][n];
  }

  // ─── Structural Analysis ──────────────────────────────────

  private structuralAnalysis(input: string): { detected: boolean; details: string[]; score: number } {
    const details: string[] = [];
    let score = 0;

    // Count XML-like tags
    const xmlTags = (input.match(/<\/?[a-zA-Z_][a-zA-Z0-9_-]*>/g) ?? []).length;
    if (xmlTags > 5) {
      details.push(`excessive_xml_tags: ${xmlTags}`);
      score = Math.max(score, 0.4 + xmlTags * 0.05);
    }

    // Count markdown headers
    const headers = (input.match(/^#{1,6}\s+/gm) ?? []).length;
    if (headers > 5) {
      details.push(`excessive_headers: ${headers}`);
      score = Math.max(score, 0.3 + headers * 0.03);
    }

    // Abnormally long input (potential token flooding)
    if (input.length > 10_000) {
      details.push(`excessive_length: ${input.length} chars`);
      score = Math.max(score, 0.3);
    }

    return { detected: details.length > 0, details, score: Math.min(score, 1.0) };
  }

  // ─── Custom Pattern Loading ───────────────────────────────

  private loadCustomPatterns(filePath: string): void {
    try {
      const content = readFileSync(resolve(filePath), "utf-8");
      const data = YAML.parse(content);
      if (Array.isArray(data?.patterns)) {
        this.customPatterns = data.patterns.map((p: Record<string, unknown>) => ({
          name: String(p.name ?? "custom"),
          pattern: String(p.pattern ?? ""),
          severity: Number(p.severity ?? 0.5),
          flag: (p.flag as InjectionFlag) ?? "pattern_match",
          description: p.description ? String(p.description) : undefined,
        }));
      }
    } catch {
      // Custom patterns file not found or invalid – continue with builtins only
    }
  }
}
