import chalk from "chalk";
import { execFile } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { DriverRegistry } from "./driver-registry.js";
import type { LLMProvider } from "../agents/provider.js";
import type { ProviderSelector } from "../agents/provider-selector.js";
import { createTTSProvider, type TTSProvider } from "../agents/tts-provider.js";
import type { PatternRegistry } from "./registry.js";
import type { McpManager } from "./mcp.js";
import type { RAGService } from "../rag/rag-service.js";
import type { QualityPipeline } from "./quality/pipeline.js";
import type { KnowledgeBus } from "./knowledge-bus.js";
import { loadWingConfig, resolveItemWing } from "./wing-resolver.js";
import { encodeMessages as encodeKcnMessages } from "./kcn.js";
import type { AiosConfig, ContextConfig, ExecutionContext, ExecutionPlan, ExecutionStep, KernelMessage, KnowledgeType, Pattern, SelectionStrategy, StepMessage, StepStatus, WorkflowResult } from "../types.js";
import { randomUUID } from "crypto";
import type { PersonaRegistry } from "./personas.js";
import type { StepExecutor } from "./executor.js";
import { ContextBuilder } from "./context-builder.js";
import { OutputExtractor } from "./output-extractor.js";
import { PromptBuilder } from "../security/prompt-builder.js";
import { PolicyEngine } from "../security/policy-engine.js";
import type { PolicyAction } from "../security/policy-engine.js";
import { AuditLogger, NullAuditLogger } from "../security/audit-logger.js";
import { userInputTaint, derivedTaint, type TaintLabel } from "../security/taint-tracker.js";
import { InputGuard } from "../security/input-guard.js";
import { KnowledgeGuard } from "../security/knowledge-guard.js";
import { ContentScanner } from "../security/content-scanner.js";
import { OutputValidator } from "../security/output-validator.js";
import { PlanEnforcer } from "../security/plan-enforcer.js";
import { CodeShield } from "../security/code-shield.js";
import { CircuitBreaker } from "../security/circuit-breaker.js";
import type { EngineOptions } from "../types.js";
import { createHash } from "crypto";
import { INTERNAL_OPS } from "./pdf-operations.js";
import { tmpdir } from "os";
import { resolve as resolvePath, isAbsolute } from "path";

/**
 * Strip prototype-pollution sinks from parsed JSON before it crosses
 * a trust boundary (MCP tool call). Recursively removes `__proto__`,
 * `constructor`, `prototype` keys — returns a plain object tree.
 */
export function sanitizeMcpArgs(input: unknown): Record<string, unknown> {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return undefined;
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[k] = walk(val);
    }
    return out;
  };
  const result = walk(input);
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return {};
  }
  return { ...(result as Record<string, unknown>) };
}

/**
 * Engine – führt einen ExecutionPlan mechanisch aus.
 * Topologische Sortierung, Promise.all für Paralleles, Retry bei Fehler.
 * Unterstützt LLM-Patterns und Tool-Patterns.
 */
export class Engine {
  private registry: PatternRegistry;
  private provider: LLMProvider;
  private config?: AiosConfig;
  private ttsProvider?: TTSProvider;
  private personaRegistry?: PersonaRegistry;
  private mcpManager?: McpManager;
  private ragService?: RAGService;
  private providerSelector?: ProviderSelector;
  private stepExecutor?: StepExecutor;
  private qualityPipeline?: QualityPipeline;
  private knowledgeBus?: KnowledgeBus;
  private contextBuilder: ContextBuilder;
  private outputExtractor: OutputExtractor;
  private promptBuilder: PromptBuilder;
  private driverRegistry?: DriverRegistry;
  private contextConfig?: ContextConfig;
  private stepTaints = new Map<string, TaintLabel>();

  // Security — always present, never silently skipped
  private policyEngine: PolicyEngine;
  private auditLogger: AuditLogger;
  private inputGuard: InputGuard;
  private knowledgeGuard: KnowledgeGuard;
  private contentScanner: ContentScanner;
  private outputValidator: OutputValidator;
  private planEnforcer: PlanEnforcer;
  private codeShield: CodeShield;
  private circuitBreaker: CircuitBreaker;
  private executionContextDefaults: Partial<ExecutionContext>;

  constructor(
    registry: PatternRegistry,
    provider: LLMProvider,
    opts: EngineOptions = {},
  ) {
    this.registry = registry;
    this.provider = provider;
    this.config = opts.config;
    this.personaRegistry = opts.personaRegistry;
    this.mcpManager = opts.mcpManager;
    this.ragService = opts.ragService;
    this.providerSelector = opts.providerSelector;
    this.stepExecutor = opts.stepExecutor;
    this.qualityPipeline = opts.qualityPipeline;
    this.knowledgeBus = opts.knowledgeBus;
    this.driverRegistry = opts.driverRegistry;
    this.contextConfig = opts.contextConfig;

    // Security defaults — no silent bypass
    this.policyEngine = opts.policyEngine ?? new PolicyEngine([]);
    this.auditLogger = opts.auditLogger ?? new NullAuditLogger();
    this.inputGuard = opts.inputGuard ?? new InputGuard();
    this.knowledgeGuard = opts.knowledgeGuard ?? new KnowledgeGuard({}, undefined, this.auditLogger);
    this.contentScanner = opts.contentScanner ?? new ContentScanner();
    this.outputValidator = opts.outputValidator ?? new OutputValidator({}, this.auditLogger);
    this.planEnforcer = opts.planEnforcer ?? new PlanEnforcer({}, this.auditLogger);
    this.executionContextDefaults = opts.executionContext ?? {};
    this.codeShield = opts.codeShield
      ?? CodeShield.fromContext(this.executionContextDefaults.interactive !== undefined
        ? { interactive: this.executionContextDefaults.interactive }
        : { interactive: true });
    this.circuitBreaker = opts.circuitBreaker
      ?? CircuitBreaker.fromContext({
        interactive: this.executionContextDefaults.interactive ?? true,
        max_write_steps: this.executionContextDefaults.max_write_steps,
      });

    this.contextBuilder = new ContextBuilder(registry);
    this.outputExtractor = new OutputExtractor();
    this.promptBuilder = new PromptBuilder();
  }

  async execute(plan: ExecutionPlan, userInput: string): Promise<WorkflowResult> {
    const results = new Map<string, StepMessage>();
    const status = new Map<string, StepStatus>();
    const retries = new Map<string, number>();
    const feedback = new Map<string, string>();
    const start = Date.now();

    const outputDir = this.config?.tools?.output_dir ?? "./output";
    const cc = this.contextConfig;
    const sandboxRoots = {
      tmp: tmpdir(),
      output: isAbsolute(outputDir) ? outputDir : resolvePath(outputDir),
    };
    const ctx: ExecutionContext = {
      trace_id: randomUUID(),
      context_id: cc?.name ?? "default",
      started_at: start,
      compliance_tags: cc?.compliance?.standards?.map(s => s.id) ?? [],
      allowed_driver_capabilities: ["file_read", "file_write"],
      sandbox_roots: sandboxRoots,
      ...this.executionContextDefaults,
    };
    this.stepTaints.clear();

    // Security: Audit + scan + plan freeze at workflow boundary
    this.auditLogger.inputReceived(userInput, ctx.trace_id, ctx.context_id);
    this.auditLogger.planCreated(JSON.stringify(plan), ctx.trace_id);
    this.circuitBreaker.reset();

    const inputScan = this.inputGuard.analyze(userInput);
    if (!inputScan.safe) {
      this.auditLogger.guardTriggered(inputScan, ctx.trace_id);
      console.error(chalk.yellow(`  ⚠️  InputGuard: ${inputScan.flags.join(", ")} (score=${inputScan.score.toFixed(2)})`));
    } else {
      this.auditLogger.guardPassed(inputScan, ctx.trace_id);
    }

    // PlanEnforcer: freeze plan, validate DAG, compute integrity hash.
    // PlanEnforcer.freeze() calls auditLogger.planFrozen() internally.
    this.planEnforcer.freeze(plan);

    plan.plan.steps.forEach((s) => { status.set(s.id, "pending"); retries.set(s.id, 0); });

    // ── Event Loop: startbare Steps finden und parallel ausführen ──
    while ([...status.values()].some((s) => s !== "done" && s !== "failed")) {
      const ready = plan.plan.steps.filter((step) => {
        if (status.get(step.id) !== "pending") return false;
        return step.depends_on.every((dep) => status.get(dep) === "done");
      });

      if (ready.length === 0) break;

      if (ready.length > 1) {
        console.error(chalk.green(`  🔀 Parallel: ${ready.map((s) => s.id).join(" + ")}`));
      }

      ready.forEach((s) => status.set(s.id, "running"));

      await Promise.all(ready.map((step) =>
        this.executeStep(step, userInput, results, status, retries, feedback, plan, ctx)
      ));
    }

    // Zusammenfassung
    console.error(chalk.blue("\n─── Ergebnis ───"));
    for (const [id, s] of status) {
      console.error(`  ${s === "done" ? "✅" : "❌"} ${id}`);
    }

    return { plan, results, status, totalDurationMs: Date.now() - start };
  }

  private async executeStep(
    step: ExecutionStep,
    userInput: string,
    results: Map<string, StepMessage>,
    status: Map<string, StepStatus>,
    retries: Map<string, number>,
    feedback: Map<string, string>,
    plan: ExecutionPlan,
    ctx: ExecutionContext
  ): Promise<void> {
    const t0 = Date.now();
    try {
      // PlanEnforcer: validate step is part of frozen plan
      const stepValid = this.planEnforcer.validateStep(step);
      if (!stepValid.valid) {
        throw new Error(`Plan violation: ${stepValid.reason}`);
      }

      const pattern = this.registry.get(step.pattern);
      if (!pattern) throw new Error(`Pattern "${step.pattern}" nicht gefunden`);

      // Pattern integrity check: verify system prompt hasn't been modified on disk
      if (pattern.contentHash) {
        const currentHash = createHash("sha256").update(pattern.systemPrompt).digest("hex");
        if (currentHash !== pattern.contentHash) {
          const msg = `Pattern integrity violation: "${pattern.meta.name}" content hash mismatch`;
          this.auditLogger.policyViolation("pattern_integrity", msg, undefined, ctx.trace_id);
          console.error(chalk.red(`  ❌ ${msg}`));
          throw new Error(msg);
        }
      }

      // Phase 5.3 Schritt A+B: Policy-Check VOR Pattern-Dispatch
      // Input-Taint = derived(taints aller depends_on) bzw. userInputTaint() für Wurzel-Steps
      const inputTaint = this.computeInputTaint(step);
      const policyAction = this.policyActionFor(pattern.meta.type ?? "llm");
      if (policyAction) {
        const decision = this.policyEngine.check(policyAction, inputTaint, ctx.trace_id, {
          patternComplianceTags: pattern.meta.compliance_tags,
          contextComplianceTags: ctx.compliance_tags,
          patternName: pattern.meta.name,
        });
        if (!decision.allowed) {
          throw new Error(
            `Policy-Verletzung: ${decision.reason ?? "blockiert"} ` +
            `(Pattern "${pattern.meta.name}", Action ${policyAction})`,
          );
        }
      }

      // Circuit Breaker: enforce limits BEFORE dispatch.
      // Running this post-dispatch would only catch the N+1-th write, not the N-th.
      const isWriteStep = pattern.meta.type === "tool"
        || pattern.meta.type === "mcp"
        || !!pattern.meta.mcp_server
        || pattern.meta.type === "kb";
      try {
        this.circuitBreaker.beforeStep(step.id, isWriteStep);
      } catch (breakerErr) {
        this.auditLogger.log({
          event_type: "circuit_breaker_tripped",
          level: "error",
          trace_id: ctx.trace_id,
          step_id: step.id,
          message: breakerErr instanceof Error ? breakerErr.message : String(breakerErr),
          metadata: { ...this.circuitBreaker.status() },
        });
        throw breakerErr;
      }

      // Input aus Dependencies + User-Input zusammenbauen
      // MCP-Patterns bekommen rohen Input (JSON), LLM-Patterns den formatierten
      const fb = feedback.get(step.id);
      const needsRawInput = pattern.meta.type === "mcp" || pattern.meta.type === "internal" || pattern.meta.type === "tool";
      const input = needsRawInput
        ? this.contextBuilder.buildRaw(step, userInput, results) +
          (fb ? "\n\n## ⚠️ FEEDBACK AUS VORHERIGEM VERSUCH\n\n" + fb : "")
        : this.contextBuilder.build(step, userInput, results, fb);

      let message: StepMessage;

      if (pattern.meta.type === "rag") {
        // ── RAG-Pattern: Semantic Search/Index/Compare ──
        console.error(chalk.gray(`  🔍 ${step.id} → ${step.pattern} [RAG: ${pattern.meta.rag_collection}/${pattern.meta.rag_operation}]`));
        message = await this.executeRag(step, pattern, input, t0);
      } else if (pattern.meta.type === "kb") {
        // ── KB-Pattern: Knowledge Bus recall/store ──
        console.error(chalk.gray(`  🧠 ${step.id} → ${step.pattern} [KB: ${pattern.meta.kb_operation}]`));
        message = await this.executeKb(step, pattern, input, t0, ctx);
      } else if (pattern.meta.type === "mcp") {
        // ── MCP-Pattern: MCP-Server Tool aufrufen ──
        console.error(chalk.gray(`  🔌 ${step.id} → ${step.pattern} [MCP: ${pattern.meta.mcp_server}/${pattern.meta.mcp_tool}]`));
        message = await this.executeMcpTool(step, pattern, input, t0);
      } else if (pattern.meta.type === "internal") {
        // ── Internal-Pattern: direkt aufrufen, kein Subprocess ──
        console.error(chalk.gray(`  📦 ${step.id} → ${step.pattern} [INTERNAL: ${pattern.meta.internal_op}]`));
        message = await this.executeInternal(step, pattern, input, t0, ctx);
      } else if (pattern.meta.type === "tool") {
        // ── Tool-Pattern: CLI-Tool ausführen ──
        const label = pattern.meta.driver
          ? `DRIVER: ${pattern.meta.driver}/${pattern.meta.operation}`
          : `TOOL: ${pattern.meta.tool}`;
        console.error(chalk.gray(`  🔧 ${step.id} → ${step.pattern} [${label}]`));
        message = await this.executeTool(step, pattern, input, t0, ctx);
      } else if (pattern.meta.type === "image_generation") {
        // ── Image-Generation-Pattern: Gemini Nano Banana ──
        console.error(chalk.gray(`  🎨 ${step.id} → ${step.pattern} [IMAGE]`));
        message = await this.executeImageGeneration(step, pattern, input, t0, ctx);
      } else if (pattern.meta.type === "tts") {
        // ── TTS-Pattern: Text-to-Speech ──
        console.error(chalk.gray(`  🔊 ${step.id} → ${step.pattern} [TTS]`));
        message = await this.executeTTS(step, pattern, input, t0, ctx);
      } else {
        // ── LLM-Pattern: Provider aufrufen ──
        console.error(chalk.gray(`  ⏳ ${step.id} → ${step.pattern}`));
        // Persona + Pattern kombinieren: WER (Persona) + WAS (Pattern)
        const personaId = step.persona ?? pattern.meta.persona;
        const persona = personaId ? this.personaRegistry?.get(personaId) : undefined;
        const systemPrompt = persona
          ? `${persona.system_prompt}\n\n---\n\n${pattern.systemPrompt}`
          : pattern.systemPrompt;

        // Vision: collect images from upstream steps
        const images = this.collectImages(step, results);
        const capability = images.length > 0 ? "vision" : undefined;

        // Prefer capability-based executor when available for plain LLM calls
        // (no vision, no explicit preferred_provider, no persona override).
        // These constraints keep the existing provider-resolution chain
        // authoritative for legacy paths while still giving new patterns
        // access to capability-based selection + automatic escalation.
        const canUseExecutor =
          this.stepExecutor !== undefined &&
          !capability &&
          !pattern.meta.preferred_provider &&
          !persona?.preferred_provider;

        let responseContent: string;
        let provenance: { provider?: string; model?: string; attempt?: number; escalationPath?: string[] } = {};

        if (canUseExecutor && this.stepExecutor) {
          // Capability-based path. StepExecutor is responsible for PromptBuilder
          // wrapping of its own LLM calls (it should do data/instruction
          // separation internally).
          const exec = await this.stepExecutor.execute(pattern, input, {
            stepId: step.id,
            workflowId: ctx.trace_id,
            execCtx: ctx,
            systemPromptOverride: systemPrompt,
          });
          responseContent = exec.response.content;
          provenance = {
            provider: exec.provider,
            model: exec.model,
            attempt: exec.attempt,
            escalationPath: exec.escalationPath.length > 1 ? exec.escalationPath : undefined,
          };
        } else {
          // Legacy / vision path. Wrap directly via PromptBuilder here to
          // enforce Data/Instruction Separation (CLAUDE.md Security Guideline).
          const providerToUse = this.resolveProvider(pattern, step, capability);
          const built = this.promptBuilder.build(systemPrompt, input, [], ctx.trace_id);
          const response = await providerToUse.complete(
            built.systemPrompt,
            built.userMessage,
            images.length > 0 ? images : undefined,
            ctx,
          );
          responseContent = response.content;
        }

        // Phase 6: Validate LLM output (canary check, schema, exfiltration)
        const validation = this.outputValidator.validate(
          responseContent, null, pattern.meta.output_type, pattern.meta.name, ctx.trace_id,
        );
        if (!validation.valid) {
          console.error(chalk.yellow(`  ⚠️  OutputValidator: ${validation.issues.map(i => `${i.severity}:${i.type}`).join(", ")}`));
        }
        responseContent = validation.cleanOutput;

        if (step.quality_gate) {
          const score = await this.checkQualityGate(step, responseContent, ctx);
          if (score < step.quality_gate.min_score) {
            throw new Error(`Quality Gate: ${score}/${step.quality_gate.min_score}`);
          }
        }

        message = this.buildMessage(step, pattern, responseContent, t0, "text");
        // Attach provenance to source header if present
        if (provenance.provider || provenance.escalationPath?.length) {
          message.source = { ...message.source, ...provenance };
        }
      }

      // ── Quality Backbone: Check at output boundaries ──
      if (this.qualityPipeline && message.contentKind === "text") {
        const isLastStep = plan.plan.steps[plan.plan.steps.length - 1].id === step.id;
        const hasDownstream = plan.plan.steps.some((s) => s.depends_on.includes(step.id));
        const isOutputBoundary = isLastStep || !hasDownstream;

        if (isOutputBoundary) {
          const personaId = step.persona ?? pattern.meta.persona;
          const persona = personaId ? this.personaRegistry?.get(personaId) : undefined;

          console.error(chalk.blue(`  🔍 Quality check: ${step.id}`));
          const qualityResult = await this.qualityPipeline.evaluate(
            message.content,
            pattern.meta,
            userInput,
            this.contextBuilder.build(step, userInput, results),
            ctx,
            {
              persona,
              workflowPosition: {
                workflowId: ctx.trace_id,
                stepId: step.id,
                isOutputBoundary: true,
              },
              knowledgeBus: this.knowledgeBus,
              rerunPattern: async (reworkHint: string, previousOutput: string) => {
                const providerToUse = this.resolveProvider(pattern, step);
                const reworkPrompt = `${pattern.systemPrompt}\n\n## REWORK FEEDBACK\n\nYour previous output had issues. Fix the following:\n${reworkHint}`;
                const reworkInput = `${this.contextBuilder.build(step, userInput, results)}\n\n## PREVIOUS OUTPUT (needs fixing)\n\n${previousOutput}`;
                const built = this.promptBuilder.build(reworkPrompt, reworkInput, [], ctx.trace_id);
                const resp = await providerToUse.complete(built.systemPrompt, built.userMessage, undefined, ctx);
                return resp.content;
              },
            },
          );

          message = {
            ...message,
            content: qualityResult.output,
          };

          if (!qualityResult.passed) {
            throw new Error(`Quality Gate blocked step "${step.id}": ${qualityResult.findings.filter(f => f.severity === "critical").map(f => f.message).join("; ")}`);
          }
        }
      }

      results.set(step.id, message);
      // Output-Taint: derived(input-taints) — Engine-Pattern verliert Trust nach LLM
      let outTaint = derivedTaint([inputTaint], `step:${step.pattern}`);

      // Phase 6: Scan tool/mcp output for injection patterns.
      // Tool and MCP steps return external data that could contain injections.
      const stepType = pattern.meta.type ?? "llm";
      const isMcp = !!pattern.meta.mcp_server;
      if (stepType === "tool" || isMcp) {
        const toolScan = this.inputGuard.analyze(message.content);
        if (!toolScan.safe) {
          outTaint = { ...outTaint, integrity: "untrusted" };
          this.auditLogger.guardTriggered(toolScan, ctx.trace_id);
        }
      }

      this.stepTaints.set(step.id, outTaint);
      this.auditLogger.stepExecuted(step.id, step.pattern, message.content, outTaint, ctx.trace_id);

      status.set(step.id, "done");
      this.circuitBreaker.recordSuccess(step.id);
      console.error(chalk.green(`  ✅ ${step.id} (${Date.now() - t0}ms)`));

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.circuitBreaker.recordError(step.id, errMsg);
      const current = retries.get(step.id) ?? 0;
      const max = step.retry?.max ?? 0;

      if (current < max) {
        console.error(chalk.yellow(`  🔄 ${step.id} retry ${current + 1}/${max}`));
        feedback.set(step.id, errMsg);
        retries.set(step.id, current + 1);
        status.set(step.id, "pending");
      } else if (step.retry?.on_failure === "rollback") {
        console.error(chalk.red(`  ⏪ ${step.id} → Saga Rollback`));
        status.set(step.id, "failed");
        // Execute compensating actions for completed steps (reverse order)
        await this.rollback(plan, results, status, ctx);
      } else if (step.retry?.on_failure === "escalate" && step.retry.escalate_to) {
        const target = step.retry.escalate_to;
        console.error(chalk.yellow(`  ⬆️  ${step.id} → eskaliert zu ${target}`));
        feedback.set(target, `Problem in "${step.id}": ${errMsg}`);
        status.set(target, "pending");
        status.set(step.id, "failed");
      } else {
        console.error(chalk.red(`  ❌ ${step.id} gescheitert: ${errMsg}`));
        status.set(step.id, "failed");
      }
    }
  }

  // ─── Message Factory ────────────────────────────────────

  /**
   * Baut eine StepMessage aus einem Content-String.
   * Extrahiert automatisch Summary und Artefakte laut Pattern-Frontmatter.
   */
  private buildMessage(
    step: ExecutionStep,
    pattern: Pattern,
    content: string,
    t0: number,
    kind: "text" | "file" = "text",
    filePath?: string,
    filePaths?: string[],
  ): StepMessage {
    const summary = this.outputExtractor.extractSummary(
      content,
      pattern.meta.output_extraction?.summary_strategy,
    );
    const artifacts = this.outputExtractor.extractArtifacts(content, pattern.meta);

    return {
      source: {
        stepId: step.id,
        pattern: step.pattern,
        persona: step.persona ?? pattern.meta.persona,
        outputType: pattern.meta.output_type,
      },
      content,
      artifacts,
      summary,
      durationMs: Date.now() - t0,
      contentKind: kind,
      filePath,
      filePaths,
    };
  }

  // ─── RAG Execution ──────────────────────────────────────────

  private async executeRag(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number
  ): Promise<StepMessage> {
    if (!this.ragService) throw new Error("RAGService nicht konfiguriert");
    const collection = pattern.meta.rag_collection;
    const operation = pattern.meta.rag_operation ?? "search";
    if (!collection) throw new Error(`RAG-Pattern "${pattern.meta.name}" hat keine rag_collection`);

    let output: string;

    switch (operation) {
      case "search": {
        const results = await this.ragService.search(collection, input, pattern.meta.rag_overrides);
        output = results.length > 0
          ? results.map((r, i) =>
              `### Treffer ${i + 1} (Score: ${r.score.toFixed(3)})\n\n${r.content}\n\nMetadata: ${JSON.stringify(r.metadata)}`
            ).join("\n\n---\n\n")
          : "Keine relevanten Ergebnisse gefunden.";
        break;
      }
      case "index": {
        // Input is JSON array of items
        let items: Array<{ id: string; content?: string; fields?: Record<string, unknown>; metadata?: Record<string, unknown> }>;
        try {
          items = JSON.parse(input);
          if (!Array.isArray(items)) items = [items];
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`RAG index: Input muss JSON-Array von Items sein (${msg})`);
        }
        const count = await this.ragService.index(collection, items);
        output = `${count} Chunks in Collection "${collection}" indexiert.`;
        break;
      }
      case "compare": {
        // Input: JSON { sourceCollection, sourceIds, topK?, minScore? }
        let params: { sourceCollection: string; sourceIds: string[]; topK?: number; minScore?: number };
        try {
          params = JSON.parse(input);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`RAG compare: Input muss JSON mit sourceCollection und sourceIds sein (${msg})`);
        }
        const results = await this.ragService.compare(
          params.sourceCollection, params.sourceIds, collection,
          params.topK, params.minScore,
        );
        output = results.length > 0
          ? results.map((r) =>
              `${r.sourceId} ↔ ${r.targetId}: ${r.score.toFixed(3)}\n  ${r.targetContent.slice(0, 200)}`
            ).join("\n\n")
          : "Keine Übereinstimmungen gefunden.";
        break;
      }
      default:
        throw new Error(`Unbekannte RAG-Operation: ${operation}`);
    }

    return this.buildMessage(step, pattern, output, t0, "text");
  }

  // ─── KB Pattern Execution (recall / store) ────────────────────
  //
  // Mechanism: kb-type patterns combine an LLM extraction step with
  // KnowledgeBus operations in a single executor. For "recall" the
  // LLM emits {search_queries: [...]} and the engine runs each query
  // against semanticSearch, then formats results as a markdown
  // context block. For "store" the LLM emits {memory_items: [...]}
  // and the engine publishes each item, returning a summary.
  //
  // Why this lives in the kernel: it's a generic mechanism (any
  // pattern can declare type: kb in its frontmatter and the engine
  // dispatches automatically). No domain-specific knowledge.
  private async executeKb(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number,
    ctx: ExecutionContext,
  ): Promise<StepMessage> {
    if (!this.knowledgeBus) {
      throw new Error("KnowledgeBus nicht konfiguriert");
    }
    const op = pattern.meta.kb_operation;
    if (!op) {
      throw new Error(`KB-Pattern "${pattern.meta.name}" hat kein kb_operation gesetzt`);
    }

    // Step 1: LLM call to extract structured intent from input
    const built = this.promptBuilder.build(
      pattern.systemPrompt,
      input,
      [],
      ctx.trace_id,
    );
    const llmResult = await this.provider.complete(
      built.systemPrompt,
      built.userMessage,
      undefined,
      ctx,
    );
    const llmJson = extractFirstJsonObject(llmResult.content);

    if (op === "recall") {
      return this.executeKbRecall(step, pattern, llmJson, ctx, t0);
    }
    if (op === "store") {
      return this.executeKbStore(step, pattern, llmJson, ctx, t0);
    }
    throw new Error(`Unbekannte kb_operation: ${op}`);
  }

  private async executeKbRecall(
    step: ExecutionStep,
    pattern: Pattern,
    llmJson: Record<string, unknown> | null,
    ctx: ExecutionContext,
    t0: number,
  ): Promise<StepMessage> {
    const kb = this.knowledgeBus!;
    const maxQueries = pattern.meta.kb_max_queries ?? 4;
    const topK = pattern.meta.kb_top_k ?? 5;

    const queries = parseRecallQueries(llmJson, maxQueries);
    if (queries.length === 0) {
      return this.buildMessage(
        step,
        pattern,
        "_Kein Kontext verfügbar: keine Suchanfragen extrahiert._",
        t0,
        "text",
      );
    }

    // Run queries in parallel; dedupe results by id and concatenate
    // into a single KCN-encoded block. KCN is the token-efficient
    // wire format for recall output — see src/core/kcn.ts.
    const seen = new Set<string>();
    const collected: KernelMessage[] = [];
    const queryResults = await Promise.all(
      queries.map(async (q) => {
        const opts: { top_k: number; type?: KnowledgeType; wing?: string; room?: string } = {
          top_k: topK,
        };
        if (q.category && !q.wing) {
          // Map common categories to message types where it makes sense.
          const typeMap: Record<string, KnowledgeType> = {
            decisions: "decision",
            facts: "fact",
            findings: "finding",
            patterns: "pattern",
            lessons: "lesson",
          };
          const t = typeMap[q.category.toLowerCase()];
          if (t) opts.type = t;
        }
        if (q.wing) opts.wing = q.wing;
        if (q.room) opts.room = q.room;
        return await kb.semanticSearch(q.query, ctx, opts);
      }),
    );

    for (const results of queryResults) {
      for (const msg of results) {
        if (seen.has(msg.id)) continue;
        seen.add(msg.id);
        collected.push(msg);
      }
    }

    // Phase 6 H2: Tag recalled content with integrity markers.
    // Non-trusted entries get wrapped so the PromptBuilder treats
    // them as data, not instructions.
    for (const msg of collected) {
      const integrity = (msg.metadata?.integrity as string) ?? "derived";
      const taint = {
        integrity: integrity as "trusted" | "derived" | "untrusted",
        confidentiality: "internal" as const,
        source: "kb",
        transformations: [] as string[],
      };
      if (integrity !== "trusted") {
        msg.content = this.knowledgeGuard.tagForInjection(msg.content, taint);
        this.auditLogger.log({
          level: "debug",
          event_type: "kb_write",
          trace_id: ctx.trace_id,
          message: `KB recall: tagged entry ${msg.id} with integrity=${integrity}`,
        });
      }
    }

    const output =
      collected.length === 0
        ? "_Kein relevanter Kontext gefunden._"
        : `## Erinnerter Kontext (KCN)\n${encodeKcnMessages(collected)}`;

    return this.buildMessage(step, pattern, output, t0, "text");
  }

  private async executeKbStore(
    step: ExecutionStep,
    pattern: Pattern,
    llmJson: Record<string, unknown> | null,
    ctx: ExecutionContext,
    t0: number,
  ): Promise<StepMessage> {
    const kb = this.knowledgeBus!;
    const items = parseStoreItems(llmJson);
    if (items.length === 0) {
      return this.buildMessage(
        step,
        pattern,
        "## Memory Store\n\n_Nichts Speicherwürdiges extrahiert._",
        t0,
        "text",
      );
    }

    const wingCfg = loadWingConfig();
    const records: Array<{
      type: KnowledgeType;
      tags: string[];
      source_pattern: string;
      content: string;
      format: "text";
      target_context: string;
      wing: string;
      room?: string;
      metadata?: Record<string, unknown>;
    }> = [];

    for (const item of items) {
      const wing = resolveItemWing({ wing: item.wing, category: item.category }, wingCfg);
      records.push({
        type: (item.type ?? "fact") as KnowledgeType,
        tags: item.tags ?? [],
        source_pattern: pattern.meta.name,
        content: item.content,
        format: "text",
        target_context: ctx.context_id,
        wing,
        room: item.room,
        metadata: item.metadata,
      });
    }

    // Dedupe + KnowledgeGuard + ContentScanner before publishing.
    const inputTaint = this.computeInputTaint(step);
    let stored = 0;
    let duplicates = 0;
    let quarantined = 0;
    let blocked = 0;
    const errors: string[] = [];
    for (const rec of records) {
      try {
        const dup = await kb.checkDuplicate(rec.content, ctx);
        if (dup) {
          duplicates++;
          continue;
        }

        // Phase 6 H2: Content-Scan for memory poisoning
        const scanResult = this.contentScanner.scan(rec.content);

        // Phase 6 H2: KnowledgeGuard taint-based routing
        const guardResult = this.knowledgeGuard.validateWrite({
          content: rec.content,
          type: rec.type as "decision" | "fact" | "requirement" | "artifact",
          tags: rec.tags,
          sourcePattern: rec.source_pattern,
          sourceStep: step.id,
          taint: inputTaint,
        }, ctx.trace_id);

        // Escalate suspicious content that would be allowed
        let decision = guardResult.decision;
        if (scanResult.suspicious && decision === "allow") {
          this.auditLogger.log({
            level: "warn",
            event_type: "kb_write_blocked",
            trace_id: ctx.trace_id,
            message: `Content scanner flagged memory write: ${scanResult.flags.join(", ")} (score=${scanResult.score.toFixed(2)})`,
          });
          decision = "queue_for_review";
        }

        switch (decision) {
          case "allow": {
            // Store with integrity label for recall-time tagging
            rec.metadata = { ...rec.metadata, integrity: inputTaint.integrity };
            await kb.publish(rec, ctx);
            stored++;
            break;
          }
          case "queue_for_review":
            quarantined++;
            break;
          case "block":
            blocked++;
            break;
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    const lines: string[] = [
      "## Memory Store",
      "",
      `- Stored: ${stored}`,
      `- Duplicates: ${duplicates}`,
      `- Quarantined: ${quarantined}`,
      `- Blocked: ${blocked}`,
      `- Failed: ${errors.length}`,
      `- Wing mapping: ${
        wingCfg.source === "context.yaml"
          ? `context.yaml (${wingCfg.contextPath})`
          : "built-in defaults"
      }`,
    ];
    if (errors.length > 0) {
      lines.push("", "## Errors");
      for (const e of errors) lines.push(`- ${e}`);
    }
    return this.buildMessage(step, pattern, lines.join("\n"), t0, "text");
  }

  // ─── Phase 5.3: Taint Propagation + Policy Mapping ─────────

  /**
   * Berechnet die Eingabe-Taint eines Steps:
   *  - Wurzel-Step (keine depends_on, oder $USER_INPUT) → userInputTaint
   *  - Sonst → derivedTaint aus den Output-Taints aller Dependencies
   */
  private computeInputTaint(step: ExecutionStep): TaintLabel {
    const upstreamIds = step.depends_on ?? [];
    const upstream = upstreamIds
      .map(id => this.stepTaints.get(id))
      .filter((t): t is TaintLabel => Boolean(t));
    if (upstream.length === 0) {
      return userInputTaint(`step:${step.id}`);
    }
    return derivedTaint(upstream, `merge:${step.id}`);
  }

  /** Map Pattern-Type → PolicyAction für check() */
  private policyActionFor(type: string): PolicyAction | undefined {
    switch (type) {
      case "tool":
      case "internal":
      case "image_generation":
      case "tts":
        return "execute_tool_pattern";
      case "mcp":
        return "execute_mcp_pattern";
      case "llm":
      case "kb":
      case "rag":
        return "execute_llm_pattern";
      default:
        return undefined;
    }
  }

  // ─── MCP Tool Execution ──────────────────────────────────────

  private async executeMcpTool(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number
  ): Promise<StepMessage> {
    if (!this.mcpManager) throw new Error("McpManager nicht konfiguriert");
    if (!pattern.meta.mcp_server || !pattern.meta.mcp_tool) {
      throw new Error(`MCP-Pattern "${pattern.meta.name}" hat kein mcp_server/mcp_tool definiert`);
    }

    // Input als JSON-Args parsen, Fallback: als { input: "..." } wrappen.
    // sanitizeMcpArgs() entfernt __proto__/constructor/prototype-Keys defensiv
    // (Prototype-Pollution-Schutz bei untrusted JSON-Inputs).
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(input);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        args = { input };
      } else {
        args = sanitizeMcpArgs(parsed as Record<string, unknown>);
      }
    } catch {
      args = { input };
    }

    const output = await this.mcpManager.callTool(pattern.meta.mcp_server, pattern.meta.mcp_tool, args);

    // Extract file paths from output (e.g. thumbnail paths)
    const filePaths = this.extractFilePaths(output);

    return this.buildMessage(
      step,
      pattern,
      output,
      t0,
      filePaths.length > 0 ? "file" : "text",
      filePaths[0],
      filePaths.length > 0 ? filePaths : undefined,
    );
  }

  // ─── Internal Module Execution ────────────────────────────

  private async executeInternal(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number,
    ctx?: ExecutionContext,
  ): Promise<StepMessage> {
    const op = pattern.meta.internal_op;
    if (!op) throw new Error(`Internal-Pattern "${pattern.meta.name}" hat kein internal_op definiert`);

    const fn = INTERNAL_OPS[op];
    if (!fn) throw new Error(`Unbekannte interne Operation: "${op}". Verfügbar: ${Object.keys(INTERNAL_OPS).join(", ")}`);

    const outputDir = this.config?.tools?.output_dir ?? "./output";
    mkdirSync(outputDir, { recursive: true });

    const allowedRoots = ctx?.sandbox_roots
      ? [ctx.sandbox_roots.tmp, ctx.sandbox_roots.output]
      : undefined;

    const timestamp = Date.now();
    const ext = pattern.meta.input_format ?? "txt";
    const outExt = pattern.meta.output_format?.[0] ?? "txt";
    const tmpInput = join(outputDir, `${step.id}-${timestamp}.${ext}`);
    const outputFile = join(outputDir, `${step.id}-${timestamp}.${outExt}`);

    writeFileSync(tmpInput, input, "utf-8");

    try {
      // H2+H3 fix: Sandbox-Roots an interne Ops weitergeben
      const { setAllowedRoots } = await import("./pdf-operations.js");
      setAllowedRoots(allowedRoots);
      const result = await fn(tmpInput, outputFile);
      setAllowedRoots(undefined);

      return this.buildMessage(
        step,
        pattern,
        result.content,
        t0,
        result.kind,
        result.kind === "file" ? (result.filePaths?.[0] ?? outputFile) : undefined,
        result.filePaths,
      );
    } finally {
      try { unlinkSync(tmpInput); } catch { /* ignore */ }
    }
  }

  // ─── Tool Execution (generisch) ────────────────────────────

  private async executeTool(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number,
    ctx?: ExecutionContext,
  ): Promise<StepMessage> {
    // Phase 5.2: Driver-Dispatch hat Vorrang vor Legacy tool/tool_args
    if (pattern.meta.driver) {
      return this.executeDriverOperation(step, pattern, input, t0, ctx);
    }

    const tool = pattern.meta.tool;
    if (!tool) throw new Error(`Tool-Pattern "${pattern.meta.name}" hat kein tool definiert`);

    console.error(chalk.yellow(
      `  ⚠ Pattern "${pattern.meta.name}" nutzt legacy tool/tool_args. ` +
      `Migrate zu driver/operation (Phase 5.2).`
    ));

    // Security: Allowlist prüfen
    const allowed = this.config?.tools?.allowed ?? [];
    if (allowed.length > 0 && !allowed.includes(tool)) {
      throw new Error(`Tool "${tool}" ist nicht in der Allowlist. Erlaubt: ${allowed.join(", ")}`);
    }

    // Verfügbarkeit prüfen
    if (!this.registry.isToolAvailable(tool)) {
      throw new Error(`Tool "${tool}" ist nicht installiert. Installiere es mit: npm install -g ${tool}`);
    }

    // Output-Verzeichnis
    const outputDir = this.config?.tools?.output_dir ?? "./output";
    mkdirSync(outputDir, { recursive: true });

    // Temp-Input und Output-Dateien
    const timestamp = Date.now();
    const ext = pattern.meta.input_format ?? "txt";
    const outExt = pattern.meta.output_format?.[0] ?? "txt";
    const tmpInput = join(outputDir, `${step.id}-${timestamp}.${ext}`);
    const outputFile = join(outputDir, `${step.id}-${timestamp}.${outExt}`);

    writeFileSync(tmpInput, input, "utf-8");

    try {
      // Args-Template auflösen: $INPUT → tmpInput, $OUTPUT → outputFile
      const args = (pattern.meta.tool_args ?? ["-i", "$INPUT", "-o", "$OUTPUT"]).map((arg) =>
        arg.replace("$INPUT", tmpInput).replace("$OUTPUT", outputFile)
      );

      // Code Shield: pre-execution static analysis (unattended only)
      const fullCmd = [tool, ...args].join(" ");
      const shieldResult = this.codeShield.analyze(fullCmd);
      if (shieldResult.verdict === "deny") {
        this.auditLogger.log({
          event_type: "codeshield_blocked",
          level: "error",
          trace_id: ctx?.trace_id,
          step_id: step.id,
          message: `CodeShield blocked tool command: ${shieldResult.risks.join(", ")}`,
          metadata: { command: fullCmd, risks: shieldResult.risks, details: shieldResult.details },
        });
        throw new Error(
          `CodeShield: ${shieldResult.risks.join(", ")} — ${shieldResult.details.join("; ")}`,
        );
      }

      const stdout = await this.execFileAsync(tool, args);

      // Parse tool stdout for multi-file output (JSON with "images" array)
      let filePaths: string[] | undefined;
      try {
        const parsed = JSON.parse(stdout.trim());
        if (Array.isArray(parsed.images) && parsed.images.length > 0) {
          filePaths = parsed.images;
        }
      } catch { /* not JSON, use default single file */ }

      // Kernel mechanism: if the pattern declares output_type: "text", inline
      // the tool's output file as message content so downstream LLM steps see
      // the actual text (not just a path string). This makes declared
      // can_precede chains like `pdf_extract_text → summarize` actually work
      // and is the enabling mechanism for user-space Tool→LLM workflows.
      // The kernel stays policy-free: it only looks at the frontmatter
      // contract (`output_type`), not at the content semantics.
      const isTextOutput = !filePaths && pattern.meta.output_type === "text";
      let content: string;
      let kind: "text" | "file";
      if (filePaths) {
        content = `Dateien extrahiert: ${filePaths.join(", ")}`;
        kind = "file";
      } else if (isTextOutput) {
        try {
          content = readFileSync(outputFile, "utf-8");
          kind = "text";
        } catch {
          // Fall back to legacy path-only message if the file is unreadable
          // (tool produced no output, crashed after partial write, etc.).
          content = `Datei erzeugt: ${outputFile}`;
          kind = "file";
        }
      } else {
        content = `Datei erzeugt: ${outputFile}`;
        kind = "file";
      }

      return this.buildMessage(
        step,
        pattern,
        content,
        t0,
        kind,
        filePaths?.[0] ?? (kind === "file" ? outputFile : undefined),
        filePaths,
      );
    } finally {
      // Temp-Input aufräumen
      try { unlinkSync(tmpInput); } catch { /* ignore */ }
    }
  }

  private execFileAsync(cmd: string, args: string[], timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${cmd} fehlgeschlagen: ${stderr || error.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Phase 5.2: Führt eine Operation eines Tool-Drivers aus.
   * Der Kernel kennt nur Schema + argv-Template; die konkrete Tool-Semantik
   * steht in drivers/<name>/driver.yaml (User Space).
   */
  private async executeDriverOperation(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number,
    ctx?: ExecutionContext,
  ): Promise<StepMessage> {
    if (!this.driverRegistry) {
      throw new Error(
        `Pattern "${pattern.meta.name}" benötigt DriverRegistry, ` +
        `aber Engine wurde ohne Driver-Registry konstruiert.`,
      );
    }
    const driverName = pattern.meta.driver!;
    const operationName = pattern.meta.operation;
    if (!operationName) {
      throw new Error(
        `Pattern "${pattern.meta.name}" hat driver=${driverName}, aber kein operation-Feld gesetzt.`,
      );
    }
    const loaded = this.driverRegistry.get(driverName);
    if (!loaded) {
      throw new Error(`Driver "${driverName}" nicht gefunden. Driver verfügbar: ${this.driverRegistry.list().map(d => d.def.name).join(", ") || "keine"}`);
    }

    // Phase 5.3 Schritt C: Driver-Capabilities gegen Context-Allowance prüfen
    if (ctx) {
      const capDecision = this.policyEngine.checkDriverCapabilities(
        loaded.def.capabilities,
        ctx,
        driverName,
        ctx.trace_id,
      );
      if (!capDecision.allowed) {
        throw new Error(`Capability-Verletzung: ${capDecision.reason ?? "blockiert"}`);
      }
    }

    // Verfügbarkeit + Version prüfen (gecached)
    this.driverRegistry.assertAvailable(driverName);

    const op = loaded.def.operations[operationName];
    if (!op) {
      throw new Error(
        `Operation "${operationName}" in Driver "${driverName}" nicht definiert. ` +
        `Verfügbar: ${Object.keys(loaded.def.operations).join(", ")}`,
      );
    }

    // Output-Verzeichnis
    const outputDir = this.config?.tools?.output_dir ?? "./output";
    mkdirSync(outputDir, { recursive: true });

    // Input-Binding: Phase-5.2 POC-Konvention
    //   - Wenn op.inputs genau EIN file-Binding hat, wird der Step-Input
    //     in eine Temp-Datei geschrieben und an diesen Key gebunden.
    //   - Für komplexere Bindings (mehrere Inputs, file_list, string)
    //     folgen eigene Conventions in Phase 5.2d.
    const timestamp = Date.now();
    const ext = pattern.meta.input_format ?? "txt";
    const outExt = pattern.meta.output_format?.[0] ?? "bin";
    const tmpInput = join(outputDir, `${step.id}-${timestamp}.${ext}`);
    const outputFile = join(outputDir, `${step.id}-${timestamp}.${outExt}`);

    const inputBindings = op.inputs ?? {};
    const inputKeys = Object.keys(inputBindings);
    const singleFileInput = inputKeys.length === 1
      && inputBindings[inputKeys[0]].type === "file";
    if (!singleFileInput) {
      throw new Error(
        `Phase-5.2-POC: Driver "${driverName}" Operation "${operationName}" ` +
        `muss genau ein file-Input-Binding haben (hat: ${inputKeys.join(", ") || "keine"}). ` +
        `Complex-Bindings kommen in Phase 5.2d.`,
      );
    }
    const inputKey = inputKeys[0];

    writeFileSync(tmpInput, input, "utf-8");

    // Output-Binding: erstes Output-Key bekommt outputFile
    const outputBindings = op.outputs ?? {};
    const outputKey = Object.keys(outputBindings)[0];
    if (!outputKey) {
      throw new Error(
        `Driver "${driverName}" Operation "${operationName}" hat kein Output-Binding.`,
      );
    }

    try {
      const { argv, outputFiles } = this.driverRegistry.resolveArgv(
        driverName,
        operationName,
        { [inputKey]: tmpInput },
        { [outputKey]: outputFile },
      );

      // Phase 5.3 Schritt D: Sandbox-Pfad-Enforcement
      // Alle resolved Input-/Output-Pfade müssen innerhalb der erlaubten
      // Sandbox-Roots des Contexts liegen (Default: tmp/output).
      if (ctx?.sandbox_roots) {
        const roots = [ctx.sandbox_roots.tmp, ctx.sandbox_roots.output].filter(Boolean);
        const checkPath = (p: string, label: string) => {
          const abs = isAbsolute(p) ? p : resolvePath(p);
          const inside = roots.some(root => abs === root || abs.startsWith(root + "/") || abs.startsWith(root + "\\"));
          if (!inside) {
            throw new Error(
              `Sandbox-Verletzung: ${label}-Pfad "${abs}" liegt außerhalb der Sandbox-Roots [${roots.join(", ")}]`,
            );
          }
        };
        checkPath(tmpInput, "Input");
        checkPath(outputFiles[outputKey], "Output");
      }

      // Code Shield: pre-execution analysis of driver invocation (unattended only)
      const fullCmd = [loaded.def.binary, ...argv].join(" ");
      const shieldResult = this.codeShield.analyze(fullCmd);
      if (shieldResult.verdict === "deny") {
        this.auditLogger.log({
          event_type: "codeshield_blocked",
          level: "error",
          trace_id: ctx?.trace_id,
          step_id: step.id,
          message: `CodeShield blocked driver command: ${shieldResult.risks.join(", ")}`,
          metadata: { command: fullCmd, risks: shieldResult.risks, details: shieldResult.details },
        });
        throw new Error(
          `CodeShield: ${shieldResult.risks.join(", ")} — ${shieldResult.details.join("; ")}`,
        );
      }

      const timeoutMs = (loaded.def.sandbox?.timeout_sec ?? 60) * 1000;
      await this.execFileAsync(loaded.def.binary, argv, timeoutMs);

      const producedPath = outputFiles[outputKey];
      const produced = existsSync(producedPath);
      if (!produced) {
        throw new Error(
          `Driver "${driverName}" Operation "${operationName}" hat kein Output ${producedPath} erzeugt`,
        );
      }

      // Phase 5.3 Schritt D: max_output_mb-Check nach Execution
      const maxMb = loaded.def.sandbox?.max_output_mb;
      if (maxMb !== undefined) {
        const { statSync } = await import("fs");
        const sizeMb = statSync(producedPath).size / (1024 * 1024);
        if (sizeMb > maxMb) {
          try { unlinkSync(producedPath); } catch { /* ignore */ }
          throw new Error(
            `Sandbox-Verletzung: Output ${producedPath} ist ${sizeMb.toFixed(1)}MB, max_output_mb=${maxMb}`,
          );
        }
      }

      const isTextOutput = pattern.meta.output_type === "text";
      let content: string;
      let kind: "text" | "file";
      if (isTextOutput) {
        try {
          content = readFileSync(producedPath, "utf-8");
          kind = "text";
        } catch {
          content = `Datei erzeugt: ${producedPath}`;
          kind = "file";
        }
      } else {
        content = `Datei erzeugt: ${producedPath}`;
        kind = "file";
      }

      return this.buildMessage(
        step,
        pattern,
        content,
        t0,
        kind,
        kind === "file" ? producedPath : undefined,
      );
    } finally {
      try { unlinkSync(tmpInput); } catch { /* ignore */ }
    }
  }

  // ─── Image Generation ──────────────────────────────────────────

  private async executeImageGeneration(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number,
    ctx: ExecutionContext
  ): Promise<StepMessage> {
    const maxIterations = step.retry?.max ?? 3;
    const maxCostCents = 50; // Hard cap: 50 cents per image generation cycle
    let currentPrompt = input;
    let filePaths: string[] = [];
    let totalCostCents = 0;
    const outputDir = this.config?.tools?.output_dir ?? "./output";
    mkdirSync(outputDir, { recursive: true });

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // ── Cost guard ──
      if (totalCostCents >= maxCostCents) {
        console.error(chalk.yellow(`    💰 Cost limit reached (${totalCostCents}¢ / ${maxCostCents}¢) — stopping refinement`));
        break;
      }

      // ── Generate image ──
      const providerToUse = this.resolveProvider(pattern, step, "image_generation");
      const imgBuilt = this.promptBuilder.build(pattern.systemPrompt, currentPrompt, [], ctx.trace_id);
      const response = await providerToUse.complete(imgBuilt.systemPrompt, imgBuilt.userMessage, undefined, ctx);
      totalCostCents += this.estimateCostCents(response.tokensUsed, pattern.meta.preferred_provider);

      if (!response.images?.length) {
        throw new Error(`Image generation returned no images for "${step.pattern}"`);
      }

      // Save prompt + images
      const timestamp = Date.now();
      const promptPath = join(outputDir, `${step.id}-${timestamp}.prompt.txt`);
      writeFileSync(promptPath, currentPrompt, "utf-8");
      console.error(chalk.gray(`    📝 ${promptPath}`));

      filePaths = [];
      for (let i = 0; i < response.images.length; i++) {
        const img = response.images[i];
        const ext = img.mimeType.includes("png") ? "png" : "jpg";
        const suffix = response.images.length > 1 ? `-${i + 1}` : "";
        const filePath = join(outputDir, `${step.id}-${timestamp}${suffix}.${ext}`);
        writeFileSync(filePath, Buffer.from(img.data, "base64"));
        filePaths.push(filePath);
        console.error(chalk.gray(`    📁 ${filePath}`));
      }

      // ── Auto-review via vision provider (if review_visual pattern exists) ──
      const reviewPattern = this.registry.get("review_visual");
      if (!reviewPattern || iteration === maxIterations) break;

      let visionProvider: import("../agents/provider.js").LLMProvider | undefined;
      try {
        visionProvider = this.resolveProvider(reviewPattern, step, "vision");
      } catch {
        // No vision provider configured — skip review
        break;
      }

      console.error(chalk.gray(`    🔍 Auto-Review (Iteration ${iteration}/${maxIterations})...`));
      const imageBase64 = readFileSync(filePaths[0]).toString("base64");
      const revBuilt = this.promptBuilder.build(reviewPattern.systemPrompt, `Review this generated image. Original prompt:\n\n${currentPrompt}`, [], ctx.trace_id);
      const reviewResponse = await visionProvider.complete(
        revBuilt.systemPrompt,
        revBuilt.userMessage,
        [imageBase64],
        ctx,
      );
      totalCostCents += this.estimateCostCents(reviewResponse.tokensUsed, reviewPattern.meta.preferred_provider);

      const review = reviewResponse.content;
      const hasHighIssues = /\|\s*\d+\s*\|\s*HIGH/i.test(review);

      if (!hasHighIssues) {
        console.error(chalk.green(`    ✅ Review passed — no HIGH issues`));
        break;
      }

      // Extract suggested prompt changes and refine
      console.error(chalk.yellow(`    ⚠️  HIGH issues found — refining prompt...`));
      console.error(chalk.gray(review.split("\n").filter(l => /HIGH/i.test(l)).map(l => `      ${l.trim()}`).join("\n")));

      // Use the review feedback to improve the prompt
      const refineProvider = this.resolveProvider(pattern, step);
      const refBuilt = this.promptBuilder.build(
        `You are a prompt engineer. You receive an image generation prompt and a design review with issues. Output ONLY the improved prompt — no explanation, no markdown fences, just the prompt text.`,
        `## Original Prompt\n\n${currentPrompt}\n\n## Design Review\n\n${review}\n\nFix all HIGH severity issues. Keep everything else unchanged.`,
        [], ctx.trace_id,
      );
      const refineResponse = await refineProvider.complete(refBuilt.systemPrompt, refBuilt.userMessage, undefined, ctx);
      totalCostCents += this.estimateCostCents(refineResponse.tokensUsed);
      currentPrompt = refineResponse.content.trim();
      console.error(chalk.gray(`    🔄 Prompt refined, regenerating... (${totalCostCents}¢ / ${maxCostCents}¢)`));
    }

    return this.buildMessage(
      step,
      pattern,
      `Bild erzeugt: ${filePaths.join(", ")}`,
      t0,
      "file",
      filePaths[0],
      filePaths,
    );
  }

  // ─── Text-to-Speech ────────────────────────────────────────────

  private async executeTTS(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number,
    ctx: ExecutionContext
  ): Promise<StepMessage> {
    const outputDir = this.config?.tools?.output_dir ?? "./output";
    mkdirSync(outputDir, { recursive: true });

    // Input-Länge begrenzen (OpenAI TTS max 4096 Zeichen, Kostenschutz)
    const maxChars = 4096;
    if (input.length > maxChars) {
      console.error(chalk.yellow(`    ⚠️  Text auf ${maxChars} Zeichen gekürzt (Original: ${input.length})`));
      input = input.slice(0, maxChars);
    }

    // TTS-Optionen aus Pattern-Meta und Step-Parametern
    const voice = pattern.meta.tts_voice ?? "alloy";
    const model = pattern.meta.tts_model ?? "tts-1";
    const format = pattern.meta.tts_format ?? "mp3";
    const speed = pattern.meta.tts_speed ?? 1.0;

    // Provider lazy erstellen und cachen
    if (!this.ttsProvider) {
      this.ttsProvider = createTTSProvider();
    }

    console.error(chalk.gray(`    🎙️  Voice: ${voice}, Model: ${model}, Format: ${format}, Speed: ${speed}x`));

    const result = await this.ttsProvider.synthesize(input, { voice, model, format, speed }, ctx);

    // Audio-Datei speichern
    const timestamp = Date.now();
    const filePath = join(outputDir, `${step.id}-${timestamp}.${result.format}`);
    writeFileSync(filePath, result.audioData);
    console.error(chalk.gray(`    📁 ${filePath} (${(result.audioData.length / 1024).toFixed(1)} KB)`));

    return this.buildMessage(
      step,
      pattern,
      `Audio erzeugt: ${filePath}`,
      t0,
      "file",
      filePath,
    );
  }

  // ─── Provider Resolution ────────────────────────────────────────

  /**
   * Priority chain for provider selection:
   * 1. Pattern preferred_provider (static, explicit)
   * 2. Persona preferred_provider (static, from persona config)
   * 3. Capability-based selection with strategy (cheapest or best)
   * 4. Default provider (fallback)
   */
  private resolveProvider(pattern: Pattern, step: ExecutionStep, capability?: string): LLMProvider {
    if (this.providerSelector) {
      // 1. Pattern preferred_provider
      if (pattern.meta.preferred_provider) {
        const explicit = this.providerSelector.getByName(pattern.meta.preferred_provider);
        if (explicit) {
          console.error(chalk.gray(`    🎯 Provider (pattern): ${explicit.name}`));
          return explicit.provider;
        }
      }

      // 2. Persona preferred_provider
      const personaId = step.persona ?? pattern.meta.persona;
      if (personaId) {
        const persona = this.personaRegistry?.get(personaId);
        if (persona?.preferred_provider) {
          const explicit = this.providerSelector.getByName(persona.preferred_provider);
          if (explicit) {
            console.error(chalk.gray(`    🎯 Provider (persona): ${explicit.name}`));
            return explicit.provider;
          }
        }
      }

      // 3. Capability-based selection with strategy
      if (capability) {
        const strategy: SelectionStrategy = pattern.meta.selection_strategy ?? "cheapest";
        const selected = this.providerSelector.select(capability, strategy);
        if (selected) {
          console.error(chalk.gray(`    🎯 Provider (${strategy}): ${selected.name}`));
          return selected.provider;
        }
      }
    }

    // If a specific capability was required but no provider supports it → fail clearly
    if (capability) {
      const hint = capability === "image_generation"
        ? `Add a provider with 'capabilities: [image_generation]' to aios.yaml. Example:\n  gemini-image:\n    type: gemini\n    model: gemini-2.0-flash-exp-image-generation\n    apiKey: \${GOOGLE_API_KEY}\n    capabilities: [image_generation]`
        : `Add a provider with 'capabilities: [${capability}]' to aios.yaml.`;
      throw new Error(
        `No provider with capability "${capability}" configured for pattern "${pattern.meta.name}".\n${hint}`
      );
    }

    // 4. Default provider (only for patterns without special capability requirements)
    return this.provider;
  }

  // ─── Cost Estimation ─────────────────────────────────────────

  /** Rough cost estimate in cents based on token usage and provider config */
  private estimateCostCents(tokens?: { input: number; output: number }, providerName?: string): number {
    if (!tokens) return 0;
    const totalTokens = tokens.input + tokens.output;
    const configured = providerName
      ? this.config?.providers?.[providerName]?.cost_per_mtok
      : undefined;
    const costPerMtok = configured ?? 0.1; // Conservative default: $0.10/Mtok
    return (totalTokens / 1_000_000) * costPerMtok * 100; // Convert $ to cents
  }

  // ─── Saga Rollback ────────────────────────────────────────────

  /**
   * Saga Rollback – führt kompensierende Aktionen für abgeschlossene Steps aus.
   * Reihenfolge: umgekehrt zur Ausführungsreihenfolge (letzter zuerst).
   */
  private async rollback(
    plan: ExecutionPlan,
    results: Map<string, StepMessage>,
    status: Map<string, StepStatus>,
    ctx: ExecutionContext
  ): Promise<void> {
    // Finde abgeschlossene Steps mit compensate-Aktion (umgekehrte Reihenfolge)
    const completedSteps = plan.plan.steps
      .filter(s => status.get(s.id) === "done" && s.compensate)
      .reverse();

    for (const step of completedSteps) {
      if (!step.compensate) continue;
      const compensatePattern = this.registry.get(step.compensate.pattern);
      if (!compensatePattern) {
        console.error(chalk.yellow(`  ⚠️  Compensate-Pattern "${step.compensate.pattern}" nicht gefunden, übersprungen`));
        continue;
      }

      try {
        // Input für Kompensation: Original-Output des Steps + Error-Kontext
        const originalOutput = results.get(step.id)?.content ?? "";
        const compensateInput = `## Zu kompensierender Output\n\n${originalOutput}\n\n## Kontext\n\nDieser Step wird zurückgerollt weil ein nachfolgender Step fehlgeschlagen ist.`;

        console.error(chalk.yellow(`  ⏪ Kompensiere ${step.id} → ${step.compensate.pattern}`));
        const compBuilt = this.promptBuilder.build(compensatePattern.systemPrompt, compensateInput, [], ctx.trace_id);
        await this.provider.complete(compBuilt.systemPrompt, compBuilt.userMessage, undefined, ctx);
        status.set(step.id, "failed"); // Mark as rolled back
        console.error(chalk.yellow(`  ↩️  ${step.id} kompensiert`));
      } catch (compError) {
        console.error(chalk.red(`  ❌ Kompensation von ${step.id} fehlgeschlagen`));
      }
    }
  }

  // ─── Vision Helpers ──────────────────────────────────────────

  /** Read image files from upstream step results as base64 */
  private collectImages(step: ExecutionStep, results: Map<string, StepMessage>): string[] {
    const images: string[] = [];
    for (const src of step.input_from) {
      if (src === "$USER_INPUT") continue;
      const r = results.get(src);
      if (r?.filePaths) {
        for (const fp of r.filePaths) {
          if (/\.(png|jpg|jpeg|webp)$/i.test(fp)) {
            try {
              images.push(readFileSync(fp).toString("base64"));
            } catch {
              // Skip unreadable files
            }
          }
        }
      }
    }
    return images;
  }

  /** Extract image file paths from text output (e.g. MCP tool results) */
  private extractFilePaths(output: string): string[] {
    const re = /(?:^|\s)((?:\/|[A-Z]:\\)[^\s]+\.(?:png|jpg|jpeg|webp))/gim;
    const paths: string[] = [];
    let match;
    while ((match = re.exec(output)) !== null) {
      paths.push(match[1]);
    }
    return paths;
  }

  // ─── Quality Gate ──────────────────────────────────

  private async checkQualityGate(step: ExecutionStep, content: string, ctx: ExecutionContext): Promise<number> {
    if (!step.quality_gate) return 10;
    const gatePattern = this.registry.get(step.quality_gate.pattern);
    if (!gatePattern) {
      console.error(chalk.yellow(`  ⚠️  Quality Gate Pattern "${step.quality_gate.pattern}" nicht gefunden, übersprungen`));
      return 10;
    }
    const gateBuilt = this.promptBuilder.build(gatePattern.systemPrompt, content, [], ctx.trace_id);
    const resp = await this.provider.complete(gateBuilt.systemPrompt, gateBuilt.userMessage, undefined, ctx);
    const match = resp.content.match(/(\d+)\s*\/?\s*10/);
    return match ? parseInt(match[1]) : 5;
  }
}

// ─────────────────────────────────────────────────────────────
// KB pattern helpers — JSON extraction and formatting
// ─────────────────────────────────────────────────────────────

interface RecallQuery {
  query: string;
  category?: string;
  wing?: string;
  room?: string;
}

interface StoreItem {
  category?: string;
  wing?: string;
  type?: string;
  room?: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Extract the first balanced JSON object from an LLM response. The
 * memory_recall and memory_store patterns instruct the LLM to emit
 * pure JSON, but real LLMs sometimes wrap it in code fences or add
 * a leading sentence. This helper finds the first `{...}` block and
 * parses it. Returns null on failure.
 */
function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // Quick path: the entire text is JSON
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* fall through */ }

  // Slow path: find a balanced { ... } block
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch { /* not valid */ }
        return null;
      }
    }
  }
  return null;
}

function parseRecallQueries(
  json: Record<string, unknown> | null,
  maxQueries: number,
): RecallQuery[] {
  if (!json) return [];
  const raw = json.search_queries;
  if (!Array.isArray(raw)) return [];
  const out: RecallQuery[] = [];
  for (const entry of raw) {
    if (out.length >= maxQueries) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.query !== "string" || !e.query.trim()) continue;
    out.push({
      query: e.query.trim(),
      category: typeof e.category === "string" ? e.category : undefined,
      wing: typeof e.wing === "string" ? e.wing : undefined,
      room: typeof e.room === "string" ? e.room : undefined,
    });
  }
  return out;
}

function parseStoreItems(json: Record<string, unknown> | null): StoreItem[] {
  if (!json) return [];
  const raw = json.memory_items;
  if (!Array.isArray(raw)) return [];
  const out: StoreItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.content !== "string" || !e.content.trim()) continue;
    out.push({
      content: e.content.trim(),
      category: typeof e.category === "string" ? e.category : undefined,
      wing: typeof e.wing === "string" ? e.wing : undefined,
      type: typeof e.type === "string" ? e.type : undefined,
      room: typeof e.room === "string" ? e.room : undefined,
      tags: Array.isArray(e.tags) ? (e.tags as unknown[]).filter((t) => typeof t === "string") as string[] : undefined,
      metadata: e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
        ? (e.metadata as Record<string, unknown>)
        : undefined,
    });
  }
  return out;
}

