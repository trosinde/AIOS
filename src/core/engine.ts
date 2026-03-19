import chalk from "chalk";
import { execFile } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import type { LLMProvider } from "../agents/provider.js";
import type { ProviderSelector } from "../agents/provider-selector.js";
import type { PatternRegistry } from "./registry.js";
import type { McpManager } from "./mcp.js";
import type { RAGService } from "../rag/rag-service.js";
import type { AiosConfig, ExecutionContext, ExecutionPlan, ExecutionStep, Persona, Pattern, SelectionStrategy, StepResult, StepStatus, WorkflowResult } from "../types.js";
import { randomUUID } from "crypto";
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
  private providerSelector?: ProviderSelector;

  constructor(
    registry: PatternRegistry,
    provider: LLMProvider,
    config?: AiosConfig,
    personaRegistry?: PersonaRegistry,
    mcpManager?: McpManager,
    ragService?: RAGService,
    providerSelector?: ProviderSelector,
  ) {
    this.registry = registry;
    this.provider = provider;
    this.config = config;
    this.personaRegistry = personaRegistry;
    this.mcpManager = mcpManager;
    this.ragService = ragService;
    this.providerSelector = providerSelector;
  }

  async execute(plan: ExecutionPlan, userInput: string): Promise<WorkflowResult> {
    const results = new Map<string, StepResult>();
    const status = new Map<string, StepStatus>();
    const retries = new Map<string, number>();
    const feedback = new Map<string, string>();
    const start = Date.now();

    const ctx: ExecutionContext = {
      trace_id: randomUUID(),
      context_id: "default",
      started_at: start,
    };

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
    results: Map<string, StepResult>,
    status: Map<string, StepStatus>,
    retries: Map<string, number>,
    feedback: Map<string, string>,
    plan: ExecutionPlan,
    ctx: ExecutionContext
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
      } else if (pattern.meta.type === "image_generation") {
        // ── Image-Generation-Pattern: Gemini Nano Banana ──
        console.error(chalk.gray(`  🎨 ${step.id} → ${step.pattern} [IMAGE]`));
        stepResult = await this.executeImageGeneration(step, pattern, input, t0, ctx);
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
        const providerToUse = this.resolveProvider(pattern, step, capability);

        const response = await providerToUse.complete(systemPrompt, input, images.length > 0 ? images : undefined, ctx);

        // Optional: Quality Gate
        if (step.quality_gate) {
          const score = await this.checkQualityGate(step, response.content, ctx);
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

    // Extract file paths from output (e.g. thumbnail paths)
    const filePaths = this.extractFilePaths(output);

    return {
      stepId: step.id,
      pattern: step.pattern,
      output,
      outputType: filePaths.length > 0 ? "file" : "text",
      filePath: filePaths[0],
      filePaths: filePaths.length > 0 ? filePaths : undefined,
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

      const stdout = await this.execFileAsync(tool, args);

      // Parse tool stdout for multi-file output (JSON with "images" array)
      let filePaths: string[] | undefined;
      try {
        const parsed = JSON.parse(stdout.trim());
        if (Array.isArray(parsed.images) && parsed.images.length > 0) {
          filePaths = parsed.images;
        }
      } catch { /* not JSON, use default single file */ }

      return {
        stepId: step.id,
        pattern: step.pattern,
        output: filePaths
          ? `Dateien extrahiert: ${filePaths.join(", ")}`
          : `Datei erzeugt: ${outputFile}`,
        outputType: "file",
        filePath: filePaths?.[0] ?? outputFile,
        filePaths,
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

  // ─── Image Generation ──────────────────────────────────────────

  private async executeImageGeneration(
    step: ExecutionStep,
    pattern: Pattern,
    input: string,
    t0: number,
    ctx: ExecutionContext
  ): Promise<StepResult> {
    // Select image_generation provider via priority chain
    const providerToUse = this.resolveProvider(pattern, step, "image_generation");

    const response = await providerToUse.complete(pattern.systemPrompt, input, undefined, ctx);

    if (!response.images?.length) {
      throw new Error(`Image generation returned no images for "${step.pattern}"`);
    }

    // Save images to output directory
    const outputDir = this.config?.tools?.output_dir ?? "./output";
    mkdirSync(outputDir, { recursive: true });
    const timestamp = Date.now();
    const filePaths: string[] = [];

    // Save prompt alongside images for reproducibility
    const promptPath = join(outputDir, `${step.id}-${timestamp}.prompt.txt`);
    writeFileSync(promptPath, input, "utf-8");
    console.error(chalk.gray(`    📝 ${promptPath}`));

    for (let i = 0; i < response.images.length; i++) {
      const img = response.images[i];
      const ext = img.mimeType.includes("png") ? "png" : "jpg";
      const suffix = response.images.length > 1 ? `-${i + 1}` : "";
      const filePath = join(outputDir, `${step.id}-${timestamp}${suffix}.${ext}`);
      writeFileSync(filePath, Buffer.from(img.data, "base64"));
      filePaths.push(filePath);
      console.error(chalk.gray(`    📁 ${filePath}`));
    }

    return {
      stepId: step.id,
      pattern: step.pattern,
      output: `Bild erzeugt: ${filePaths.join(", ")}`,
      outputType: "file",
      filePath: filePaths[0],
      filePaths,
      durationMs: Date.now() - t0,
    };
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

  // ─── Saga Rollback ────────────────────────────────────────────

  /**
   * Saga Rollback – führt kompensierende Aktionen für abgeschlossene Steps aus.
   * Reihenfolge: umgekehrt zur Ausführungsreihenfolge (letzter zuerst).
   */
  private async rollback(
    plan: ExecutionPlan,
    results: Map<string, StepResult>,
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
        const originalOutput = results.get(step.id)?.output ?? "";
        const compensateInput = `## Zu kompensierender Output\n\n${originalOutput}\n\n## Kontext\n\nDieser Step wird zurückgerollt weil ein nachfolgender Step fehlgeschlagen ist.`;

        console.error(chalk.yellow(`  ⏪ Kompensiere ${step.id} → ${step.compensate.pattern}`));
        await this.provider.complete(compensatePattern.systemPrompt, compensateInput, undefined, ctx);
        status.set(step.id, "failed"); // Mark as rolled back
        console.error(chalk.yellow(`  ↩️  ${step.id} kompensiert`));
      } catch (compError) {
        console.error(chalk.red(`  ❌ Kompensation von ${step.id} fehlgeschlagen`));
      }
    }
  }

  // ─── Vision Helpers ──────────────────────────────────────────

  /** Read image files from upstream step results as base64 */
  private collectImages(step: ExecutionStep, results: Map<string, StepResult>): string[] {
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

  private async checkQualityGate(step: ExecutionStep, content: string, ctx: ExecutionContext): Promise<number> {
    if (!step.quality_gate) return 10;
    const gatePattern = this.registry.get(step.quality_gate.pattern);
    if (!gatePattern) {
      console.error(chalk.yellow(`  ⚠️  Quality Gate Pattern "${step.quality_gate.pattern}" nicht gefunden, übersprungen`));
      return 10;
    }
    const resp = await this.provider.complete(gatePattern.systemPrompt, content, undefined, ctx);
    const match = resp.content.match(/(\d+)\s*\/?\s*10/);
    return match ? parseInt(match[1]) : 5;
  }
}
