/**
 * AIOS Security Module – Defense-in-Depth against Prompt Injection.
 *
 * Layers of protection:
 *   1. Input Guard (input-guard.ts) – Input boundary protection
 *   2. Prompt Builder (prompt-builder.ts) – Data/instruction separation
 *   3. Plan Enforcer (plan-enforcer.ts) – Plan immutability
 *   3b. Taint Tracker (taint-tracker.ts) – Information flow control
 *   3b. Policy Engine (policy-engine.ts) – Deterministic policy enforcement
 *   3c. Code Shield (code-shield.ts) – Pre-execution command analysis (unattended)
 *   4. Output Validator (output-validator.ts) – Output validation
 *   5. Knowledge Guard (knowledge-guard.ts) – Knowledge base integrity
 *   6. Audit Logger (audit-logger.ts) – Audit trail
 *   7. Circuit Breaker (circuit-breaker.ts) – Step/time/error limiting (unattended)
 */

export { InputGuard, type InputGuardResult, type InputGuardConfig, type InjectionFlag, DEFAULT_GUARD_CONFIG } from "./input-guard.js";
export { PromptBuilder, type BuiltPrompt, type PromptContext, type PromptBuilderConfig, DEFAULT_PROMPT_CONFIG } from "./prompt-builder.js";
export { generateCanary, checkCanary, stripCanary, type CanaryToken, type CanaryCheckResult } from "./canary.js";
export { PlanEnforcer, type FrozenPlan, type PlanEnforcerConfig, DEFAULT_ENFORCER_CONFIG } from "./plan-enforcer.js";
export { type TaintLabel, type IntegrityLevel, type ConfidentialityLevel, type LabeledValue, userInputTaint, trustedTaint, derivedTaint, mergeIntegrity, mergeConfidentiality, meetsIntegrity, label } from "./taint-tracker.js";
export { PolicyEngine, type Policy, type PolicyAction, type PolicyDecision, DEFAULT_POLICIES } from "./policy-engine.js";
export { OutputValidator, type OutputValidationResult, type OutputIssue, type OutputValidatorConfig, DEFAULT_OUTPUT_CONFIG } from "./output-validator.js";
export { KnowledgeGuard, type KnowledgeWriteRequest, type KnowledgeWriteResult, type KnowledgeGuardConfig, DEFAULT_KB_GUARD_CONFIG } from "./knowledge-guard.js";
export { AuditLogger, NullAuditLogger, type AuditEntry, type AuditEventType, type AuditLoggerConfig, DEFAULT_AUDIT_CONFIG } from "./audit-logger.js";
export { ContentScanner, type ContentScanResult, type ContentFlag } from "./content-scanner.js";
export { CodeShield, type CommandAnalysis, type CommandVerdict, type CommandRisk, type CodeShieldConfig, DEFAULT_CODESHIELD_CONFIG, UNATTENDED_CODESHIELD_CONFIG, normalizeCommand } from "./code-shield.js";
export { DEFAULT_RULES, type CodeShieldRuleSet, type RulePattern } from "./codeshield-rules.js";
export { CircuitBreaker, type BreakerState, type BreakerStatus, type CircuitBreakerConfig, DEFAULT_BREAKER_CONFIG, UNATTENDED_BREAKER_CONFIG } from "./circuit-breaker.js";
