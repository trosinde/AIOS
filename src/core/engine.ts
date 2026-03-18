import chalk from "chalk";
import { execFile } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import type { LLMProvider } from "../agents/provider.js";
import type { PatternRegistry } from "./registry.js";
import type { McpManager } from "./mcp.js";
import type { RAGService } from "../rag/rag-service.js";
import type { AiosConfig, ExecutionPlan, ExecutionStep, Persona, Pattern, StepResult, StepStatus, WorkflowResult } from "../types.js";
import type { PersonaRegistry } from "./personas.js";

/**
 * Engine – führt einen ExecutionPlan mechanisch aus.
 * Topologische Sortierung, Promise.all für Paralleles, Retry bei Fehler.
 * Unterstützt LLM-Patterns und Tool-Patterns.
 */
export class Engine {
  private registry: PatternRegistry;
  private provider: LLMProvider;
  private config?: AiosConfig;
  private personaRegistry?: PersonaRegistry;
  private mcpManager?: McpManager;
  private ragService?: RAGService;

  constructor(
    registry: PatternRegistry,
    provider: LLMProvider,
    config?: AiosConfig,
    personaRegistry?: PersonaRegistry,
    mcpManager?: McpManager,
    ragService?: RAGService,
  ) {
    this.registry = registry;
    this.provider = provider;
    this.config = config;
    this.personaRegistry = personaRegistry;
    this.mcpManager = mcpManager;
    this.ragService = ragService;
  }

  async execute(plan: ExecutionPlan, userInput: string): Promise<WorkflowResult> {
    const results = new Map<string, StepResult>();
    const status = new Map<string, StepStatus>();
    const retries = new Map<string, number>();
    const feedback = new Map<string, string>();
    const start = Date.now();

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
        this.executeStep(step, userInput, results, status, retries, feedback, plan)
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
    results: Map<string, StepResult>,
    status: Map<string, StepStatus>,
    retries: Map<string, number>,
    feedback: Map<string, string>,
    plan: ExecutionPlan
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const pattern = this.registry.get(step.pattern);
      if (!pattern) throw new Error(`Pattern "${step.pattern}" nicht gefunden`);

      // Input aus Dependencies + User-Input zusammenbauen
      // MCP-Patterns bekommen rohen Input (JSON), LLM-Patterns den formatierten
      let input = pattern.meta.type === "mcp"
        ? this.buildRawInput(step, userInput, results)
        : this.buildInput(step, userInput, results);
      if (feedback.has(step.id)) {
        input += "\n\n## ⚠️ FEEDBACK AUS VORHERIGEM VERSUCH\n\n" + feedback.get(step.id);
      }

      let stepResult: StepResult;

      if (pattern.meta.type === "rag") {
        // ── RAG-Pattern: Semantic Search/Index/Compare ──
        console.error(chalk.gray(`  🔍 ${step.id} → ${step.pattern} [RAG: ${pattern.meta.rag_collection}/${pattern.meta.rag_operation}]`));
        stepResult = await this.executeRag(step, pattern, input, t0);
      } else if (pattern.meta.type === "mcp") {
        // ── MCP-Pattern: MCP-Server Tool aufrufen ──
        console.error(chalk.gray(`  🔌 ${step.id} → ${step.pattern} [MCP: ${pattern.meta.mcp_server}/${pattern.meta.mcp_tool}]`));
        stepResult = await this.executeMcpTool(step, pattern, input, t0);
      } else if (pattern.meta.type === "tool") {
        // ── Tool-Pattern: CLI-Tool ausführen ──
        console.error(chalk.gray(`  🔧 ${step.id} → ${step.pattern} [TOOL: ${pattern.meta.tool}]`));
        stepResult = await this.executeTool(step, pattern, input, t0);
      } else {
        // ── LLM-Pattern: Provider aufrufen ──
        console.error(chalk.gray(`  ⏳ ${step.id} → ${step.pattern}`));
        // Persona + Pattern kombinieren: WER (Persona) + WAS (Pattern)
        const personaId = step.persona ?? pattern.meta.persona;
        const persona = personaId ? this.personaRegistry?.get(personaId) : undefined;
        const systemPrompt = persona
          ? `${persona.system_prompt}\n\n---\n\n${pattern.systemPrompt}`
          : pattern.systemPrompt;
        const response = await this.provider.complete(systemPrompt, input);

        // Optional: Quality Gate
        if (step.quality_gate) {
          const score = await this.checkQualityGate(step, response.content);
          if (score < step.quality_gate.min_score) {
            throw new Error(`Quality Gate: ${score}/${step.quality_gate.min_score}`);
          }
        }

        stepResult = {
          stepId: step.id,
          pattern: step.pattern,
          output: response.content,
          outputType: "text",
          durationMs: Date.now() - t0,
        };
      }

      results.set(step.id, stepResult);
      status.set(step.id, "done");
      console.error(chalk.green(`  ✅ ${step.id} (${Date.now() - t0}ms)`));

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
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
        await this.rollback(plan, results, status);
      } else if (step.retry?.on_failure === "escalate" && step.retry.escalate_to) {
        const target = step.retry.escalate_to;
        console.error(chalk.yellow(`  ⬆️  ${step.id} → eskaliert zu ${target}`));
        feedback.set(target, `Problem in "${step.id}": ${errMsg}`);
        status.set(target, "pending");
        status.set(step.id, "failed");
      } else {
        console.error(chalk.red(`  ❌ ${step.id} gescheitert`));
        status.set(step.id, "failed");
      }
    }
  }

  // ─── RAG Execution ──────────────────────────────────────────

  private async executeRag(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number
  ): Promise<StepResult> {
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
        } catch {
          throw new Error("RAG index: Input muss JSON-Array von Items sein");
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
        } catch {
          throw new Error("RAG compare: Input muss JSON mit sourceCollection und sourceIds sein");
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

    return {
      stepId: step.id,
      pattern: step.pattern,
      output,
      outputType: "text",
      durationMs: Date.now() - t0,
    };
  }

  // ─── MCP Tool Execution ──────────────────────────────────────

  private async executeMcpTool(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number
  ): Promise<StepResult> {
    if (!this.mcpManager) throw new Error("McpManager nicht konfiguriert");
    if (!pattern.meta.mcp_server || !pattern.meta.mcp_tool) {
      throw new Error(`MCP-Pattern "${pattern.meta.name}" hat kein mcp_server/mcp_tool definiert`);
    }

    // Input als JSON-Args parsen, Fallback: als { input: "..." } wrappen
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(input);
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        args = { input };
      }
    } catch {
      args = { input };
    }

    const output = await this.mcpManager.callTool(pattern.meta.mcp_server, pattern.meta.mcp_tool, args);

    return {
      stepId: step.id,
      pattern: step.pattern,
      output,
      outputType: "text",
      durationMs: Date.now() - t0,
    };
  }

  // ─── Tool Execution (generisch) ────────────────────────────

  private async executeTool(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number
  ): Promise<StepResult> {
    const tool = pattern.meta.tool;
    if (!tool) throw new Error(`Tool-Pattern "${pattern.meta.name}" hat kein tool definiert`);

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

      await this.execFileAsync(tool, args);

      return {
        stepId: step.id,
        pattern: step.pattern,
        output: `Datei erzeugt: ${outputFile}`,
        outputType: "file",
        filePath: outputFile,
        durationMs: Date.now() - t0,
      };
    } finally {
      // Temp-Input aufräumen
      try { unlinkSync(tmpInput); } catch { /* ignore */ }
    }
  }

  private execFileAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 60_000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${cmd} fehlgeschlagen: ${stderr || error.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  // ─── Saga Rollback ────────────────────────────────────────────

  /**
   * Saga Rollback – führt kompensierende Aktionen für abgeschlossene Steps aus.
   * Reihenfolge: umgekehrt zur Ausführungsreihenfolge (letzter zuerst).
   */
  private async rollback(
    plan: ExecutionPlan,
    results: Map<string, StepResult>,
    status: Map<string, StepStatus>
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
        const originalOutput = results.get(step.id)?.output ?? "";
        const compensateInput = `## Zu kompensierender Output\n\n${originalOutput}\n\n## Kontext\n\nDieser Step wird zurückgerollt weil ein nachfolgender Step fehlgeschlagen ist.`;

        console.error(chalk.yellow(`  ⏪ Kompensiere ${step.id} → ${step.compensate.pattern}`));
        await this.provider.complete(compensatePattern.systemPrompt, compensateInput);
        status.set(step.id, "failed"); // Mark as rolled back
        console.error(chalk.yellow(`  ↩️  ${step.id} kompensiert`));
      } catch (compError) {
        console.error(chalk.red(`  ❌ Kompensation von ${step.id} fehlgeschlagen`));
      }
    }
  }

  // ─── Input & Quality Gate ──────────────────────────────────

  /** Raw input für MCP-Patterns (kein Markdown-Wrapping, damit JSON parsebar bleibt) */
  private buildRawInput(step: ExecutionStep, userInput: string, results: Map<string, StepResult>): string {
    return step.input_from
      .map((src) => {
        if (src === "$USER_INPUT") return userInput;
        const r = results.get(src);
        return r ? r.output : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  private buildInput(step: ExecutionStep, userInput: string, results: Map<string, StepResult>): string {
    return step.input_from
      .map((src) => {
        if (src === "$USER_INPUT") return `## Aufgabe\n\n${userInput}`;
        const r = results.get(src);
        return r ? `## Ergebnis von "${src}"\n\n${r.output}` : "";
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  private async checkQualityGate(step: ExecutionStep, content: string): Promise<number> {
    if (!step.quality_gate) return 10;
    const gatePattern = this.registry.get(step.quality_gate.pattern);
    if (!gatePattern) {
      console.error(chalk.yellow(`  ⚠️  Quality Gate Pattern "${step.quality_gate.pattern}" nicht gefunden, übersprungen`));
      return 10;
    }
    const resp = await this.provider.complete(gatePattern.systemPrompt, content);
    const match = resp.content.match(/(\d+)\s*\/?\s*10/);
    return match ? parseInt(match[1]) : 5;
  }
}
