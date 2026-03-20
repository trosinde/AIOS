# AIOS Security Architecture

## Overview

AIOS implements **Defense-in-Depth** against Prompt Injection – the #1 threat to LLM applications (OWASP Top 10 for LLM 2025). The architecture provides six layers of protection, combining heuristic detection with deterministic enforcement.

**Core Principle:** You cannot filter your way out of prompt injection. The goal is not to detect all injections (impossible), but to **limit the impact** of successful injections – similar to how ASLR/DEP/CFG work in system security.

## Why AIOS Is Particularly Vulnerable

AIOS combines multiple properties that individually increase attack surface:

1. **Multi-LLM-Call Pipeline** – User input flows through Router → Engine → multiple Steps
2. **Router as Meta-Agent** – A single LLM call determines the entire execution plan
3. **Knowledge Base Persistence** – LLM outputs can be stored and reused across sessions
4. **Tool/CLI Execution** – Some patterns execute actual CLI commands
5. **Cross-Context IPC** – Knowledge can flow between isolated contexts

## AIOS-Specific Attack Vectors

| Vector | Description | Severity |
|--------|-------------|----------|
| Router Hijacking | Input manipulates Router into selecting wrong patterns | CRITICAL |
| Pattern Override | Input overrides system.md instructions | HIGH |
| Knowledge Poisoning | Tainted LLM output persists as "fact" in KB | CRITICAL |
| Cross-Agent Contamination | Poisoned KB entry affects future agents | CRITICAL |
| Tool Pattern Abuse | Injection causes CLI execution with crafted args | HIGH |
| Pipe Chain Escalation | Output from Step A becomes injection into Step B | HIGH |
| Persona Impersonation | Input causes persona to act outside its role | MEDIUM |
| Compliance Artifact Manipulation | Tainted outputs generate false compliance reports | HIGH |

## Defense-in-Depth Architecture

![AIOS Security Architecture](security-architecture.png)

| Layer | Component | Source | Key Features |
|-------|-----------|--------|-------------|
| **1** | Input Boundary Guard | `src/security/input-guard.ts` | Unicode normalization, regex patterns, encoding detection, fuzzy keyword matching (typoglycemia-resistant) |
| **2** | Prompt Architecture | `src/security/prompt-builder.ts` | Instruction hierarchy, data tagging (`<user_data>`), canary tokens, delimiter diversity |
| **3** | Execution Control | `src/security/plan-enforcer.ts` | Plan immutability (hash + freeze), Router input sanitization, allowed-patterns-set enforcement |
| **3b** | Information Flow Control | `src/security/taint-tracker.ts` + `src/security/policy-engine.ts` | Taint tracking, deterministic policy engine (no LLM heuristics) |
| **4** | Output Validation | `src/security/output-validator.ts` | Canary verification, schema validation, exfiltration detection |
| **5** | Knowledge Integrity | `src/security/knowledge-guard.ts` | Write validation, taint persistence, review queue, provenance |
| **6** | Audit Trail | `src/security/audit-logger.ts` | JSONL logging, compliance-grade event trail |

## Taint Tracking Model

Every data value flowing through AIOS carries a `TaintLabel`:

```typescript
interface TaintLabel {
  integrity: "trusted" | "derived" | "untrusted";
  confidentiality: "public" | "internal" | "confidential";
  source: string;
  transformations: string[];
}
```

### Propagation Rules

| Operation | Resulting Integrity |
|-----------|-------------------|
| User input | `untrusted` |
| Pattern system.md content | `trusted` |
| LLM output from trusted input | `derived` |
| LLM output from untrusted input | `untrusted` |
| Knowledge base (manually validated) | `trusted` |
| Knowledge base (auto-extracted) | `derived` |
| Merge of trusted + untrusted | `untrusted` (conservative) |

### Policy Engine Rules

The Policy Engine enforces deterministic rules (no LLM heuristics):

| Action | Required Integrity | On Violation |
|--------|-------------------|-------------|
| Execute tool pattern (CLI) | `derived+` | Block |
| Execute MCP pattern | `derived+` | Block |
| Execute LLM pattern | Any | Warn |
| Write to Knowledge Base | `derived+` | Queue for review |
| Generate compliance artifact | `trusted` only | Block |
| Modify execution plan | Never allowed | Block |
| Cross-context IPC | `derived+` | Block |

## Plan-then-Execute Pattern

The Router **never sees raw user input**. This is a security invariant:

```
User Input ──┐
             │
    ┌────────┤
    │        │
    ▼        │
 ROUTER      │  ← Sees only sanitized task description
 (plans)     │     + pattern catalog
    │        │
    ▼        │
 FROZEN      │  ← Plan is hashed and immutable
 PLAN ───────┤
             │
    ▼        ▼
 ENGINE ← raw input enters here, inside <user_data> tags
```

## Configuration

All security features are configurable via `aios.yaml`:

```yaml
security:
  input_guard:
    enabled: true
    mode: block          # warn | block
    threshold: 0.7
    patterns_file: security/injection-patterns.yaml
  prompt:
    data_tagging: true
    canary_tokens: true
    instruction_hierarchy: true
  execution:
    plan_immutability: true
    taint_tracking: true
    policy_enforcement: true
  output:
    canary_check: true
    schema_validation: true
    exfiltration_detection: true
  knowledge:
    auto_review: true
    taint_persistence: true
    provenance_tracking: true
  audit:
    enabled: true
    log_file: logs/security-audit.jsonl
    log_level: info
```

## References

- [OWASP Top 10 LLM 2025 – LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP PI Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [Design Patterns for Securing LLM Agents (Beurer-Kellner et al., 2025)](https://arxiv.org/abs/2506.08837)
- [FIDES – IFC for AI Agents (Microsoft, 2025)](https://arxiv.org/abs/2505.23643)
- [Prompt Flow Integrity](https://arxiv.org/abs/2503.15547)
