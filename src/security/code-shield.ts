/**
 * Code Shield – Layer 3c: Pre-execution Command Analysis.
 *
 * Mechanism. Statically analyses bash commands before `execFile()`.
 * Policy content (the 12 risk rule-sets) lives in `codeshield-rules.ts`
 * and is injected via `CodeShieldConfig.rules`. The kernel module owns
 * no domain knowledge — it just runs the rules it is given.
 *
 * Activation model:
 *   - Attended (interactive: true, default) → disabled.
 *   - Unattended (interactive: false)       → enabled, strict defaults.
 *
 * Pipeline position:
 *   PolicyEngine → CodeShield → execFile()
 *
 * Reference: OWASP A03:2021 – Injection, CWE-78 (OS Command Injection).
 *
 * Bypass hardening (addresses review finding C2):
 *   Before matching, the command is normalised to collapse common obfuscations:
 *     - "rm", 'rm', r""m, \rm    → rm               (quoting/escape)
 *     - $'\x72m', $'\162m'         → rm               (ANSI-C decoding)
 *     - /usr/bin/rm, /bin/rm       → rm               (absolute paths)
 *     - busybox rm, toybox rm      → rm               (multi-call wrappers)
 *     - doas rm                    → rm               (sudo-alternatives)
 *   Residual gaps (documented in SECURITY.md):
 *     - Variable splitting: a=rm; $a … (requires interpreter)
 *     - Unicode homoglyphs in denyList substring
 *     - Network exfiltration through allow-listed binaries
 *   For hard isolation, run unattended agents under a restricted OS user
 *   with a minimal PATH.
 */

import type { RulePattern, CodeShieldRuleSet } from "./codeshield-rules.js";
import { DEFAULT_RULES } from "./codeshield-rules.js";

// ─── Types ────────────────────────────────────────────────

export type CommandVerdict = "allow" | "deny" | "modify";

export type CommandRisk =
  | "shell_injection"
  | "path_traversal"
  | "privilege_escalation"
  | "network_exfil"
  | "destructive"
  | "package_mutation"
  | "service_control"
  | "user_management"
  | "config_modification"
  | "unsafe_redirect"
  | "interpreter_exec"
  | "env_exposure"
  | "not_allowed"
  | "too_long";

export interface CommandAnalysis {
  command: string;
  normalized?: string;
  verdict: CommandVerdict;
  risks: CommandRisk[];
  details: string[];
  sanitized?: string;
}

export interface CodeShieldConfig {
  enabled: boolean;
  mode: "warn" | "block";
  allowList: string[];
  denyList: string[];
  allowedWritePaths: string[];
  maxCommandLength: number;
  rules: CodeShieldRuleSet;
}

// ─── Defaults ─────────────────────────────────────────────

export const DEFAULT_CODESHIELD_CONFIG: CodeShieldConfig = {
  enabled: false,
  mode: "block",
  allowList: [],
  denyList: [],
  allowedWritePaths: [],
  maxCommandLength: 4096,
  rules: DEFAULT_RULES,
};

export const UNATTENDED_CODESHIELD_CONFIG: Partial<CodeShieldConfig> = {
  enabled: true,
  mode: "block",
  denyList: [
    "rm -rf /",
    "mkfs",
    "dd if=/dev",
    "shred",
    "> /dev/sda",
  ],
};

// ─── Normalisation (C2 — defeat simple bypasses) ──────────

/**
 * Normalise a command so that common bash obfuscations collapse to the
 * literal form the rule-sets expect. This is a best-effort heuristic,
 * NOT a full shell parser. Known limits are documented in the module
 * header and in SECURITY.md.
 */
export function normalizeCommand(raw: string): string {
  let s = raw;

  // 1. ANSI-C quoting: $'...' decodes \xHH, \0NNN, \n, \t, \\, \'
  s = s.replace(/\$'((?:[^'\\]|\\.)*)'/g, (_, body: string) => {
    return body
      .replace(/\\x([0-9a-fA-F]{1,2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\([0-7]{1,3})/g, (_m, o) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .replace(/\\'/g, "'");
  });

  // 2. Remove paired double / single quotes. Preserves content order so
  //    r""m and "rm" both collapse to rm. Intentionally non-shell-exact —
  //    we only care about detection, not execution semantics.
  s = s.replace(/"/g, "").replace(/'/g, "");

  // 3. Strip backslash escapes (\r, \m, …). Keep line breaks collapsed to
  //    whitespace so multi-line injected commands stay on one analysis plane.
  s = s.replace(/\\\n/g, " ").replace(/\\(.)/g, "$1");

  // 4. Collapse absolute path prefixes for common interpreters/binaries
  //    so /usr/bin/rm and /bin/rm look like rm to the rule matchers.
  s = s.replace(/(?<![\w/])\/(?:usr\/)?(?:local\/)?s?bin\/([a-zA-Z][\w.-]*)/g, "$1");

  // 5. Multi-call wrappers and sudo-alternatives: collapse prefixed form.
  //    "busybox rm -rf /" → "rm -rf /"; "doas apt install x" → "apt install x".
  s = s.replace(/\b(?:busybox|toybox|doas|pkexec)\s+/g, "");

  // 6. Normalise whitespace runs so \s-based regex behave predictably.
  s = s.replace(/\s+/g, " ");

  return s;
}

// ─── Code Shield ──────────────────────────────────────────

export class CodeShield {
  private config: CodeShieldConfig;

  constructor(config: Partial<CodeShieldConfig> = {}) {
    this.config = {
      ...DEFAULT_CODESHIELD_CONFIG,
      ...config,
      rules: { ...DEFAULT_RULES, ...(config.rules ?? {}) } as CodeShieldRuleSet,
    };
  }

  static fromContext(
    ctx: { interactive?: boolean },
    overrides: Partial<CodeShieldConfig> = {},
  ): CodeShield {
    if (ctx.interactive === false) {
      return new CodeShield({ ...UNATTENDED_CODESHIELD_CONFIG, ...overrides });
    }
    return new CodeShield({ enabled: false, ...overrides });
  }

  analyze(command: string): CommandAnalysis {
    const cmd = command ?? "";

    if (!this.config.enabled) {
      return { command: cmd, verdict: "allow", risks: [], details: [] };
    }

    const risks: CommandRisk[] = [];
    const details: string[] = [];
    const rules = this.config.rules;

    // Length check — on the raw input, before normalisation may shorten it.
    if (cmd.length > this.config.maxCommandLength) {
      details.push(`command_too_long: ${cmd.length} > ${this.config.maxCommandLength}`);
      return {
        command: cmd,
        verdict: this.config.mode === "warn" ? "allow" : "deny",
        risks: ["too_long"],
        details,
      };
    }

    // C2: run detection against a normalised form as well. Raw is kept
    // for regex that deliberately depend on literal shell syntax
    // (chaining operators, pipes).
    const normalized = normalizeCommand(cmd);

    // Shell injection first — chaining operators neutralise any allowList
    // guarantees, so detect them before anything else. Run on BOTH raw and
    // normalised (quotes removed may reveal hidden operators).
    for (const pat of rules.shellInjection) {
      if (pat.test(cmd) || pat.test(normalized)) {
        addRisk(risks, details, "shell_injection", `pattern: ${pat.source}`);
        break;
      }
    }

    // Pipe-to-interpreter always applies — it's how "benign" tools
    // (curl, cat, base64) become arbitrary-code vectors.
    for (const pat of rules.pipeToInterpreter) {
      if (pat.test(cmd) || pat.test(normalized)) {
        addRisk(risks, details, "interpreter_exec", `pipe-to-interpreter: ${pat.source}`);
        break;
      }
    }

    // DenyList — substring match on BOTH raw and normalised so that
    // "rm\u0020-rf /" and "\rm -rf /" both get caught.
    for (const deny of this.config.denyList) {
      if (!deny) continue;
      if (cmd.includes(deny) || normalized.includes(deny)) {
        addRisk(risks, details, "destructive", `denylist_match: "${deny}"`);
        return {
          command: cmd,
          normalized,
          verdict: this.config.mode === "warn" ? "allow" : "deny",
          risks,
          details,
        };
      }
    }

    const allowMatched = this.matchesAllowList(cmd) || this.matchesAllowList(normalized);

    // AllowList suppression: an explicit allowList prefix match is an
    // operator-vetted action. Shell injection + denyList + pipe-to-interpreter
    // already ran above and are unaffected.
    if (!allowMatched) {
      scan([cmd, normalized], rules.destructive, risks, details, "destructive");
      scan([cmd, normalized], rules.interpreter, risks, details, "interpreter_exec");
      scan([cmd, normalized], rules.envExposure, risks, details, "env_exposure");
      scan([cmd, normalized], rules.userMgmt, risks, details, "user_management");
      scan([cmd, normalized], rules.service, risks, details, "service_control");
      scan([cmd, normalized], rules.package, risks, details, "package_mutation");
      scan([cmd, normalized], rules.privilege, risks, details, "privilege_escalation");
      scan([cmd, normalized], rules.network, risks, details, "network_exfil");
    }

    // Path traversal, redirects, critical reads — on normalised form.
    if (/\.\.\//.test(normalized)) {
      addRisk(risks, details, "path_traversal", `../ sequence detected`);
    }
    const redirectMatch = normalized.match(/>>?\s*(\S+)/);
    if (redirectMatch) {
      const target = redirectMatch[1];
      const absolute = target.startsWith("/");
      const allowed = this.config.allowedWritePaths.some((root) =>
        target === root || target.startsWith(root.endsWith("/") ? root : root + "/"),
      );
      if (absolute && !allowed) {
        if (rules.criticalPaths.some((re) => re.test(target))) {
          addRisk(risks, details, "config_modification", `write to critical path "${target}"`);
        }
        if (/^\/dev\//.test(target) || /^\/etc\/passwd$/.test(target) || /^\/etc\/shadow$/.test(target)) {
          addRisk(risks, details, "unsafe_redirect", `redirect to "${target}"`);
        } else if (!rules.criticalPaths.some((re) => re.test(target))) {
          addRisk(risks, details, "unsafe_redirect", `redirect to unapproved absolute path "${target}"`);
        }
      }
    }
    const readMatch = normalized.match(/\b(?:cat|less|more|head|tail|od|xxd|hexdump)\s+(\S+)/);
    if (readMatch) {
      const target = readMatch[1];
      if (rules.criticalPaths.some((re) => re.test(target))) {
        addRisk(risks, details, "path_traversal", `read from critical path "${target}"`);
      }
    }

    // AllowList enforcement — if non-empty, demand a prefix match.
    if (this.config.allowList.length > 0 && !allowMatched && risks.length === 0) {
      details.push(`not_in_allowlist: no prefix matches command`);
      return {
        command: cmd,
        normalized,
        verdict: this.config.mode === "warn" ? "allow" : "deny",
        risks: ["not_allowed"],
        details,
      };
    }

    if (risks.length > 0) {
      return {
        command: cmd,
        normalized,
        verdict: this.config.mode === "warn" ? "allow" : "deny",
        risks,
        details,
      };
    }

    return { command: cmd, normalized, verdict: "allow", risks: [], details };
  }

  enforce(command: string): string {
    const result = this.analyze(command);
    if (result.verdict === "deny") {
      throw new Error(
        `CodeShield: ${result.risks.join(", ")} — ${result.details.join("; ")}`,
      );
    }
    return result.sanitized ?? result.command;
  }

  private matchesAllowList(command: string): boolean {
    const trimmed = command.trim();
    for (const prefix of this.config.allowList) {
      if (!prefix) continue;
      if (trimmed === prefix) return true;
      if (trimmed.startsWith(prefix + " ") || trimmed.startsWith(prefix + "\t")) {
        return true;
      }
    }
    return false;
  }
}

function addRisk(
  risks: CommandRisk[],
  details: string[],
  risk: CommandRisk,
  detail: string,
): void {
  if (!risks.includes(risk)) risks.push(risk);
  details.push(`${risk}: ${detail}`);
}

function scan(
  variants: string[],
  patterns: RulePattern[],
  risks: CommandRisk[],
  details: string[],
  risk: CommandRisk,
): void {
  for (const p of patterns) {
    if (variants.some((v) => p.re.test(v))) {
      addRisk(risks, details, risk, p.desc);
    }
  }
}
