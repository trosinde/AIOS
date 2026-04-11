#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { PatternRegistry } from "./core/registry.js";
import { PersonaRegistry } from "./core/personas.js";
import { Router } from "./core/router.js";
import { Engine } from "./core/engine.js";
import { McpManager, registerMcpTools } from "./core/mcp.js";
import { createProvider } from "./agents/provider.js";
import { createTTSProvider } from "./agents/tts-provider.js";
import { ProviderSelector } from "./agents/provider-selector.js";
import { RAGService } from "./rag/rag-service.js";
import { loadConfig } from "./utils/config.js";
import { buildContextAwareRegistry } from "./utils/registry-factory.js";
import { readStdin } from "./utils/stdin.js";
import { startRepl } from "./core/repl.js";
import { QualityPipeline } from "./core/quality/pipeline.js";
import type { AiosConfig, Pattern, QualityLevel } from "./types.js";
import type { LLMProvider } from "./agents/provider.js";

/** Build all providers and a ProviderSelector from config */
function buildProviderSelector(config: AiosConfig): ProviderSelector {
  const allProviders = new Map<string, LLMProvider>();
  for (const [name, cfg] of Object.entries(config.providers)) {
    try { allProviders.set(name, createProvider(cfg)); } catch { /* skip unconfigured */ }
  }
  return new ProviderSelector(allProviders, config.providers);
}

/** Build QualityPipeline from config (returns undefined if quality not configured) */
function buildQualityPipeline(
  config: AiosConfig,
  provider: LLMProvider,
  personas?: PersonaRegistry,
  levelOverride?: QualityLevel,
): QualityPipeline | undefined {
  const qualityConfig = config.quality;
  if (!qualityConfig && !levelOverride) return undefined;

  const effectiveConfig = qualityConfig ?? {
    level: levelOverride ?? "minimal",
    policies: {},
  };

  if (levelOverride) {
    effectiveConfig.level = levelOverride;
  }

  return new QualityPipeline(effectiveConfig, provider, personas, config);
}

/** MCP-Server verbinden und Tools als virtuelle Patterns registrieren */
async function setupMcp(config: AiosConfig, registry: PatternRegistry): Promise<McpManager | undefined> {
  if (!config.mcp || Object.keys(config.mcp.servers).length === 0) return undefined;

  const mcpManager = new McpManager(config.mcp);
  let totalTools = 0;
  for (const serverName of Object.keys(config.mcp.servers)) {
    try {
      const tools = await mcpManager.listTools(serverName);
      const serverCfg = config.mcp.servers[serverName];
      registerMcpTools(tools, registry, serverName, serverCfg.exclude);
      const excluded = serverCfg.exclude?.length ?? 0;
      totalTools += tools.length - excluded;
    } catch (err) {
      console.error(`  ⚠️  MCP-Server "${serverName}" nicht erreichbar: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (totalTools > 0) {
    console.error(chalk.gray(`  🔌 ${totalTools} MCP-Tools registriert`));
  }
  return mcpManager;
}

const program = new Command();

program
  .name("aios")
  .description("AI Orchestration System")
  .version("0.1.0");

// ─── Default: Dynamische Orchestrierung ──────────────────
program
  .argument("[task...]", "Aufgabe in natürlicher Sprache")
  .option("--dry-run", "Nur planen, nicht ausführen")
  .option("--provider <name>", "LLM Provider überschreiben")
  .option("--quality <level>", "Quality Level überschreiben (minimal|standard|regulated)")
  .option("--cross", "Cross-Context Modus: Orchestriert über mehrere Kontexte")
  .option("--context <name>", "Aufgabe an spezifischen Kontext delegieren")
  .action(async (taskParts: string[], opts) => {
    const stdinInput = await readStdin();
    const task = taskParts.join(" ");
    if (!task && !stdinInput) { program.help(); return; }

    const fullInput = [task, stdinInput].filter(Boolean).join("\n\n");

    // ─── Cross-Context Modus ────────────────────────────
    if (opts.cross) {
      const { buildContextCatalog, readRegistry } = await import("./context/registry.js");
      const { CrossContextEngine, validateCrossContextPlan } = await import("./context/cross-engine.js");
      const { randomUUID } = await import("node:crypto");
      const config = loadConfig();
      const providerName = opts.provider || config.defaults.provider;
      const providerCfg = config.providers[providerName];
      if (!providerCfg) {
        console.error(chalk.red(`Provider "${providerName}" nicht gefunden.`));
        process.exit(1);
      }

      const registry = readRegistry();
      if (registry.contexts.length === 0) {
        console.error(chalk.red("Keine Kontexte registriert. Registriere mit: aios context scan <pfad>"));
        process.exit(1);
      }

      const provider = createProvider(providerCfg);
      const catalog = buildContextCatalog();

      // Load cross-router pattern
      const pRegistry = buildContextAwareRegistry(config.paths.patterns);
      const crossRouter = pRegistry.get("_cross_router");
      if (!crossRouter) {
        console.error(chalk.red("Cross-Router-Pattern nicht gefunden."));
        process.exit(1);
      }

      const systemPrompt = crossRouter.systemPrompt.replace("{CONTEXT_CATALOG}", catalog);
      console.error(chalk.blue("🌐 Cross-Context Routing..."));

      // ExecutionContext für den Cross-Context-Lauf
      const crossCtx = { trace_id: randomUUID(), context_id: "cross-context", started_at: Date.now() };
      const response = await provider.complete(systemPrompt, fullInput, undefined, crossCtx);

      let rawPlan: unknown;
      try {
        const jsonMatch = response.content.match(/```json\s*([\s\S]*?)```/) || [null, response.content];
        rawPlan = JSON.parse((jsonMatch[1] ?? response.content).trim());
      } catch {
        console.error(chalk.red("Cross-Context Router hat kein valides JSON geliefert."));
        console.error(response.content);
        process.exit(1);
      }

      // Schema-Validierung des LLM-generierten Plans
      let plan: import("./types.js").CrossContextPlan;
      try {
        plan = validateCrossContextPlan(rawPlan);
      } catch (err) {
        console.error(chalk.red(`Ungültiger Cross-Context Plan: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      const crossEngine = new CrossContextEngine();
      const result = await crossEngine.execute(plan, fullInput, crossCtx);

      // Output last step result
      const lastStep = plan.plan.steps[plan.plan.steps.length - 1];
      const lastResult = result.results.get(lastStep.id);
      if (lastResult) {
        process.stdout.write(lastResult.output);
      }

      console.error(chalk.green(`\n✅ Cross-Context Ausführung abgeschlossen (${result.totalDurationMs}ms)`));
      return;
    }

    // ─── Single-Context Modus ───────────────────────────
    if (opts.context) {
      const { readRegistry } = await import("./context/registry.js");
      const { readManifest, assertPathWithinBase } = await import("./context/manifest.js");
      const { resolve: resolvePath } = await import("node:path");

      const registry = readRegistry();
      const entry = registry.contexts.find((c) => c.name === opts.context);
      if (!entry) {
        console.error(chalk.red(`Kontext "${opts.context}" nicht gefunden.`));
        process.exit(1);
      }

      const manifest = readManifest(entry.path);
      const config = loadConfig();
      const providerName = opts.provider || manifest.config.default_provider || config.defaults.provider;
      const providerCfg = config.providers[providerName];
      if (!providerCfg) {
        console.error(chalk.red(`Provider "${providerName}" nicht gefunden.`));
        process.exit(1);
      }

      const provider = createProvider(providerCfg);

      // Path Traversal Schutz
      const patternsDir = resolvePath(entry.path, ".aios", manifest.config.patterns_dir);
      assertPathWithinBase(patternsDir, entry.path);
      const personasDir = resolvePath(entry.path, ".aios", manifest.config.personas_dir);
      assertPathWithinBase(personasDir, entry.path);

      const pRegistry = new PatternRegistry(patternsDir);
      const personas = new PersonaRegistry(personasDir);
      const router = new Router(pRegistry, provider);
      const engine = new Engine(pRegistry, provider, config, personas);

      console.error(chalk.blue(`🎯 Kontext: ${manifest.name} (${manifest.type})`));
      console.error(chalk.blue("🧠 Analysiere Aufgabe..."));

      const plan = await router.planWorkflow(fullInput);
      console.error(chalk.blue(`📋 Plan: ${plan.plan.type} (${plan.plan.steps.length} Schritte)`));

      if (opts.dryRun) { console.log(JSON.stringify(plan, null, 2)); return; }

      const result = await engine.execute(plan, fullInput);
      const lastStep = plan.plan.steps[plan.plan.steps.length - 1];
      const output = result.results.get(lastStep.id);
      if (output) process.stdout.write(output.content);
      return;
    }

    const config = loadConfig();
    const registry = buildContextAwareRegistry(config.paths.patterns);
    const mcpManager = await setupMcp(config, registry);
    const providerName = opts.provider || config.defaults.provider;
    const providerCfg = config.providers[providerName];
    if (!providerCfg) {
      console.error(chalk.red(`Provider "${providerName}" nicht gefunden.`));
      console.error(chalk.gray("Verfügbar: " + Object.keys(config.providers).join(", ")));
      process.exit(1);
    }
    const provider = createProvider(providerCfg);
    const personas = new PersonaRegistry(config.paths.personas);
    const router = new Router(registry, provider);
    const ragService = config.rag ? new RAGService(config.rag) : undefined;
    const selector = buildProviderSelector(config);
    const qualityPipeline = buildQualityPipeline(config, provider, personas, opts.quality as QualityLevel | undefined);
    const engine = new Engine(registry, provider, config, personas, mcpManager, ragService, selector, qualityPipeline);

    if (qualityPipeline) {
      console.error(chalk.gray(`  🛡️  Quality: ${qualityPipeline.getLevel()} (${qualityPipeline.getActivePolicies().join(", ")})`));
    }

    console.error(chalk.blue("🧠 Analysiere Aufgabe..."));
    const plan = await router.planWorkflow(fullInput);

    console.error(chalk.blue(`📋 Plan: ${plan.plan.type} (${plan.plan.steps.length} Schritte)`));
    for (const s of plan.plan.steps) {
      const pat = registry.get(s.pattern);
      const typeBadge = pat?.meta.type === "mcp" ? chalk.blue(" [MCP]") : pat?.meta.type === "tool" ? chalk.magenta(" [TOOL]") : pat?.meta.type === "rag" ? chalk.yellow(" [RAG]") : "";
      const par = s.parallel_group ? chalk.green(` [∥ ${s.parallel_group}]`) : "";
      console.error(`   ${s.id} → ${chalk.cyan(s.pattern)}${typeBadge}${par}`);
    }

    if (opts.dryRun) { await mcpManager?.shutdown(); console.log(JSON.stringify(plan, null, 2)); return; }

    console.error(chalk.blue("\n⚡ Starte...\n"));
    const result = await engine.execute(plan, fullInput);

    // Output: Letzten Step ausgeben, bei Datei-Output den Pfad
    const lastStep = plan.plan.steps[plan.plan.steps.length - 1];
    const output = result.results.get(lastStep.id);
    if (output) {
      if (output.contentKind === "file" && output.filePath) {
        console.error(chalk.green(`\n📁 Datei erzeugt: ${output.filePath}`));
      }
      process.stdout.write(output.content);
    }
    await mcpManager?.shutdown();
  });

// ─── aios run <pattern> (Fabric-Style, mit Parametern) ───
program
  .command("run <pattern>")
  .description("Ein Pattern direkt ausführen (stdin → LLM → stdout)")
  .option("--provider <name>", "LLM Provider überschreiben")
  .option("--quality <level>", "Quality Level überschreiben (minimal|standard|regulated)")
  .allowUnknownOption(true)
  .action(async (patternName: string, _opts, cmd: Command) => {
    const input = await readStdin();
    if (!input) {
      console.error(chalk.red(`Kein Input. Nutze: echo "text" | aios run ${patternName}`));
      process.exit(1);
    }

    const config = loadConfig();
    const registry = buildContextAwareRegistry(config.paths.patterns);
    const mcpManager = await setupMcp(config, registry);
    const pattern = registry.get(patternName);
    if (!pattern) {
      console.error(chalk.red(`Pattern "${patternName}" nicht gefunden.`));
      console.error(chalk.gray("Verfügbar: " + registry.list().join(", ")));
      process.exit(1);
    }

    // Parameter aus CLI-Args extrahieren (--key=value)
    const params = parsePatternParams(cmd.args);
    let systemPrompt = pattern.systemPrompt;

    // Parameter in Prompt injizieren
    if (Object.keys(params).length > 0) {
      const paramBlock = Object.entries(params)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n");
      systemPrompt += `\n\n## PARAMETER\n\n${paramBlock}`;
    }

    const providerName = cmd.opts().provider || config.defaults.provider;
    const providerCfg = config.providers[providerName];
    if (!providerCfg) {
      console.error(chalk.red(`Provider "${providerName}" nicht gefunden.`));
      process.exit(1);
    }
    const provider = createProvider(providerCfg);
    const personas = new PersonaRegistry(config.paths.personas);

    const ragService = config.rag ? new RAGService(config.rag) : undefined;
    const selector = buildProviderSelector(config);

    if (pattern.meta.type === "rag") {
      // RAG-Pattern: Über Engine ausführen
      const engine = new Engine(registry, provider, config, personas, mcpManager, ragService, selector);
      const ragPlan = {
        analysis: { goal: "direct run", complexity: "low" as const, requires_compliance: false, disciplines: [] },
        plan: {
          type: "pipe" as const,
          steps: [{ id: "run", pattern: patternName, depends_on: [], input_from: ["$USER_INPUT"] }],
        },
        reasoning: "Direct RAG execution",
      };
      const result = await engine.execute(ragPlan, input);
      const out = result.results.get("run");
      if (out) process.stdout.write(out.content);
    } else if (pattern.meta.type === "mcp") {
      // MCP-Pattern: Über Engine ausführen
      const engine = new Engine(registry, provider, config, personas, mcpManager, ragService, selector);
      const mcpPlan = {
        analysis: { goal: "direct run", complexity: "low" as const, requires_compliance: false, disciplines: [] },
        plan: {
          type: "pipe" as const,
          steps: [{ id: "run", pattern: patternName, depends_on: [], input_from: ["$USER_INPUT"] }],
        },
        reasoning: "Direct MCP tool execution",
      };
      const result = await engine.execute(mcpPlan, input);
      const out = result.results.get("run");
      if (out) process.stdout.write(out.content);
    } else if (pattern.meta.type === "tool") {
      // Tool-Pattern: Über Engine ausführen (mit Allowlist-Check)
      const engine = new Engine(registry, provider, config, personas, mcpManager, ragService, selector);
      const toolPlan = {
        analysis: { goal: "direct run", complexity: "low" as const, requires_compliance: false, disciplines: [] },
        plan: {
          type: "pipe" as const,
          steps: [{ id: "run", pattern: patternName, depends_on: [], input_from: ["$USER_INPUT"] }],
        },
        reasoning: "Direct tool execution",
      };
      const result = await engine.execute(toolPlan, input);
      const out = result.results.get("run");
      if (out) {
        if (out.contentKind === "file" && out.filePath) {
          console.error(chalk.green(`📁 Datei erzeugt: ${out.filePath}`));
        }
        process.stdout.write(out.content);
      }
    } else if (pattern.meta.type === "image_generation") {
      // Image-Generation-Pattern: Über Engine ausführen (speichert Bilder in output/)
      const engine = new Engine(registry, provider, config, personas, mcpManager, ragService, selector);
      const imgPlan = {
        analysis: { goal: "direct run", complexity: "low" as const, requires_compliance: false, disciplines: [] },
        plan: {
          type: "pipe" as const,
          steps: [{ id: "run", pattern: patternName, depends_on: [], input_from: ["$USER_INPUT"] }],
        },
        reasoning: "Direct image generation",
      };
      const result = await engine.execute(imgPlan, input);
      const out = result.results.get("run");
      if (out) {
        if (out.contentKind === "file" && out.filePath) {
          console.error(chalk.green(`📁 Datei erzeugt: ${out.filePath}`));
        }
        process.stdout.write(out.content);
      }
    } else if (pattern.meta.type === "tts") {
      // TTS-Pattern: Über Engine ausführen (speichert Audio in output/)
      const engine = new Engine(registry, provider, config, personas, mcpManager, ragService, selector);
      const ttsPlan = {
        analysis: { goal: "direct run", complexity: "low" as const, requires_compliance: false, disciplines: [] },
        plan: {
          type: "pipe" as const,
          steps: [{ id: "run", pattern: patternName, depends_on: [], input_from: ["$USER_INPUT"] }],
        },
        reasoning: "Direct TTS execution",
      };
      const result = await engine.execute(ttsPlan, input);
      const out = result.results.get("run");
      if (out) {
        if (out.contentKind === "file" && out.filePath) {
          console.error(chalk.green(`🔊 Audio erzeugt: ${out.filePath}`));
        }
        process.stdout.write(out.content);
      }
    } else if (pattern.meta.input_type === "image") {
      // Vision-Pattern: Dateipfade aus stdin lesen, als Base64 an Vision-Provider
      const filePaths = input.trim().split(/\n/).map(l => l.trim()).filter(Boolean);
      const images: string[] = [];
      for (const fp of filePaths) {
        try {
          const { readFileSync: rfs } = await import("fs");
          images.push(rfs(fp).toString("base64"));
        } catch {
          console.error(chalk.yellow(`  ⚠️  Bild nicht lesbar: ${fp}`));
        }
      }
      if (images.length === 0) {
        console.error(chalk.red(`Keine lesbaren Bilder. Nutze: echo "pfad/bild.png" | aios run ${patternName}`));
        process.exit(1);
      }
      const personaId = pattern.meta.persona;
      const persona = personaId ? personas.get(personaId) : undefined;
      const fullPrompt = persona
        ? `${persona.system_prompt}\n\n---\n\n${systemPrompt}`
        : systemPrompt;
      const visionProvider = selector?.select("vision")?.provider ?? provider;
      const response = await visionProvider.complete(fullPrompt, `Review this image. File paths: ${filePaths.join(", ")}`, images);
      process.stdout.write(response.content);
    } else {
      // LLM-Pattern: Persona + Pattern kombinieren
      const personaId = pattern.meta.persona;
      const persona = personaId ? personas.get(personaId) : undefined;
      const fullPrompt = persona
        ? `${persona.system_prompt}\n\n---\n\n${systemPrompt}`
        : systemPrompt;
      const response = await provider.complete(fullPrompt, input);

      // Quality Backbone: check at output boundary
      const qualityLevel = cmd.opts().quality as QualityLevel | undefined;
      const qualityPipeline = buildQualityPipeline(config, provider, personas, qualityLevel);
      if (qualityPipeline) {
        const { randomUUID } = await import("crypto");
        const ctx = { trace_id: randomUUID(), context_id: "default", started_at: Date.now() };
        console.error(chalk.gray(`  🛡️  Quality: ${qualityPipeline.getLevel()} (${qualityPipeline.getActivePolicies().join(", ")})`));
        const qualityResult = await qualityPipeline.evaluate(
          response.content,
          pattern.meta,
          input,
          input,
          ctx,
          {
            persona: persona ?? undefined,
            rerunPattern: async (reworkHint: string, previousOutput: string) => {
              const reworkPrompt = `${fullPrompt}\n\n## REWORK FEEDBACK\n\nFix the following:\n${reworkHint}`;
              const reworkInput = `${input}\n\n## PREVIOUS OUTPUT (needs fixing)\n\n${previousOutput}`;
              const resp = await provider.complete(reworkPrompt, reworkInput);
              return resp.content;
            },
          },
        );
        process.stdout.write(qualityResult.output);
        if (qualityResult.findings.length > 0) {
          console.error(chalk.gray(`\n  Quality: ${qualityResult.decision} (${qualityResult.findings.length} findings, ${qualityResult.reworkAttempts} reworks)`));
        }
      } else {
        process.stdout.write(response.content);
      }
    }
    await mcpManager?.shutdown();
  });

// ─── aios speak (Text-to-Speech Shortcut) ──────────────
program
  .command("speak [text...]")
  .description("Text in Sprache umwandeln (OpenAI TTS)")
  .option("--voice <voice>", "Stimme: alloy, echo, fable, onyx, nova, shimmer", "alloy")
  .option("--model <model>", "TTS-Modell: tts-1 oder tts-1-hd", "tts-1")
  .option("--format <format>", "Audio-Format: mp3, wav, opus, aac", "mp3")
  .option("--speed <speed>", "Geschwindigkeit (0.25 - 4.0)", "1.0")
  .option("--output <path>", "Ausgabedatei (Standard: output/speak-<timestamp>.<format>)")
  .action(async (textParts: string[], opts) => {
    // Input: CLI-Argument oder stdin
    let text = textParts.join(" ").trim();
    if (!text) {
      text = (await readStdin())?.trim() ?? "";
    }
    if (!text) {
      console.error(chalk.red("Kein Text angegeben. Nutze: aios speak \"Hallo Welt\" oder echo \"Text\" | aios speak"));
      process.exit(1);
    }

    const config = loadConfig();
    const outputDir = config.tools?.output_dir ?? "./output";
    mkdirSync(outputDir, { recursive: true });

    const voice = opts.voice;
    const model = opts.model;
    const format = opts.format;
    const speed = parseFloat(opts.speed);

    try {
      const ttsProvider = createTTSProvider();
      const { randomUUID } = await import("crypto");
      const ctx = { trace_id: randomUUID(), context_id: "cli", started_at: Date.now() };

      console.error(chalk.gray(`🔊 TTS: Voice=${voice}, Model=${model}, Format=${format}, Speed=${speed}x`));
      console.error(chalk.gray(`   Text: "${text.length > 80 ? text.slice(0, 80) + "..." : text}"`));

      const result = await ttsProvider.synthesize(text, { voice, model, format, speed }, ctx);

      // Ausgabedatei bestimmen — bei --output Pfad validieren
      let outputPath: string;
      if (opts.output) {
        const { resolve } = await import("path");
        const resolved = resolve(opts.output);
        const cwd = resolve(".");
        if (!resolved.startsWith(cwd)) {
          console.error(chalk.red("Ausgabepfad muss innerhalb des Arbeitsverzeichnisses liegen."));
          process.exit(1);
        }
        outputPath = resolved;
      } else {
        outputPath = join(outputDir, `speak-${Date.now()}.${result.format}`);
      }

      writeFileSync(outputPath, result.audioData);
      const sizeKB = (result.audioData.length / 1024).toFixed(1);
      console.error(chalk.green(`✅ Audio gespeichert: ${outputPath} (${sizeKB} KB)`));
    } catch (error) {
      console.error(chalk.red(`TTS-Fehler: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ─── aios plan (nur planen) ──────────────────────────────
program
  .command("plan <task...>")
  .description("Workflow planen ohne auszuführen")
  .option("--provider <name>", "LLM Provider überschreiben")
  .action(async (taskParts: string[], opts) => {
    const config = loadConfig();
    const registry = buildContextAwareRegistry(config.paths.patterns);
    const mcpManager = await setupMcp(config, registry);
    const providerName = opts.provider || config.defaults.provider;
    const providerCfg = config.providers[providerName];
    if (!providerCfg) {
      console.error(chalk.red(`Provider "${providerName}" nicht gefunden.`));
      process.exit(1);
    }
    const provider = createProvider(providerCfg);
    const router = new Router(registry, provider);
    const plan = await router.planWorkflow(taskParts.join(" "));
    console.log(JSON.stringify(plan, null, 2));
    await mcpManager?.shutdown();
  });

// ─── aios chat (Interaktive REPL) ────────────────────────
program
  .command("chat")
  .description("Interaktive Chat-Session starten")
  .option("--provider <name>", "LLM Provider überschreiben")
  .action(async (opts) => {
    const config = loadConfig();
    const registry = buildContextAwareRegistry(config.paths.patterns);
    const mcpManager = await setupMcp(config, registry);
    const providerName = opts.provider || config.defaults.provider;
    const providerCfg = config.providers[providerName];
    if (!providerCfg) {
      console.error(chalk.red(`Provider "${providerName}" nicht gefunden.`));
      console.error(chalk.gray("Verfügbar: " + Object.keys(config.providers).join(", ")));
      process.exit(1);
    }
    const provider = createProvider(providerCfg);
    const personas = new PersonaRegistry(config.paths.personas);
    const ragService = config.rag ? new RAGService(config.rag) : undefined;
    const selector = buildProviderSelector(config);
    const router = new Router(registry, provider);
    const engine = new Engine(registry, provider, config, personas, mcpManager, ragService, selector);

    await startRepl({ provider, registry, personas, router, engine, config, mcpManager });
    await mcpManager?.shutdown();
  });

// ─── aios context ───────────────────────────────────────
const contextCmd = program.command("context").description("Context-Verwaltung");

contextCmd
  .command("switch <name>")
  .description("Aktiven Context wechseln")
  .action(async (name: string) => {
    const { ContextManager } = await import("./core/context.js");
    const cm = new ContextManager();
    try {
      cm.switch(name);
      console.log(chalk.green(`Aktiver Context: ${name}`));
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

contextCmd
  .command("list")
  .description("Alle Contexts auflisten")
  .action(async () => {
    const { ContextManager } = await import("./core/context.js");
    const cm = new ContextManager();
    const active = cm.resolveActive();
    const contexts = cm.list();

    if (contexts.length === 0) {
      console.log(chalk.gray("  Keine Contexts. Standard: default"));
      console.log(chalk.gray("  Erstelle mit: aios init"));
      return;
    }

    for (const ctx of contexts) {
      const isActive = ctx.name === active.name ? chalk.green(" (aktiv)") : "";
      const source = ctx.source === "project" ? chalk.blue(" [lokal]") : chalk.gray(" [global]");
      console.log(`  ${chalk.cyan(ctx.name.padEnd(25))}${source}${isActive}`);
      if (ctx.config.description) console.log(`    ${chalk.gray(ctx.config.description)}`);
    }
  });

contextCmd
  .command("show")
  .description("Aktiven Context anzeigen")
  .action(async () => {
    const { ContextManager } = await import("./core/context.js");
    const cm = new ContextManager();
    const active = cm.resolveActive();

    console.log(chalk.bold(`Context: ${active.name}`));
    console.log(chalk.gray(`Quelle: ${active.source === "project" ? "Projekt-lokal (.aios/)" : "Global (~/.aios/contexts/)"}`));
    console.log(chalk.gray(`Pfad: ${active.path}`));
    if (active.config.description) console.log(chalk.gray(`Beschreibung: ${active.config.description}`));
    if (active.config.project?.domain) console.log(chalk.gray(`Domain: ${active.config.project.domain}`));
    if (active.config.required_traits?.length) {
      console.log(chalk.gray(`Required Traits: ${active.config.required_traits.join(", ")}`));
    }

    // Show federation links if manifest exists
    try {
      const { readManifest, hasContext } = await import("./context/manifest.js");
      if (hasContext(active.path)) {
        const manifest = readManifest(active.path);
        if (manifest.links?.length) {
          console.log(chalk.gray(`Links: ${manifest.links.map((l) => `${l.name} (${l.relationship})`).join(", ")}`));
        }
      }
    } catch {
      // No manifest available – skip links display
    }
  });

// ─── aios context rename <new-name> ─────────────────────
contextCmd
  .command("rename <new-name>")
  .description("Aktiven Context umbenennen")
  .action(async (newName: string) => {
    const { ContextManager } = await import("./core/context.js");
    const { readRegistry, writeRegistry } = await import("./context/registry.js");
    const cm = new ContextManager();
    const active = cm.resolveActive();

    if (active.name === "default") {
      console.error(chalk.red("Der Default-Context kann nicht umbenannt werden."));
      process.exit(1);
    }

    try {
      const result = cm.rename(active.name, newName);

      // Update global registry (best-effort, rename already succeeded)
      try {
        const registry = readRegistry();
        const entry = registry.contexts.find((c) => c.name === active.name);
        if (entry) {
          entry.name = newName;
          entry.path = result.path;
          entry.last_updated = new Date().toISOString();
          for (const other of registry.contexts) {
            if (other.links) {
              for (const link of other.links) {
                if (link.name === active.name) link.name = newName;
              }
            }
          }
          writeRegistry(registry);
        }
      } catch {
        console.error(chalk.yellow("Context umbenannt, aber Registry-Update fehlgeschlagen. Führe 'aios context scan' aus."));
      }

      console.error(chalk.green(`Context umbenannt: ${active.name} → ${newName}`));
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

// ─── aios context info [name] ────────────────────────────
contextCmd
  .command("info [name]")
  .description("Details eines Kontexts anzeigen (Federation-Manifest)")
  .action(async (name?: string) => {
    const YAML = await import("yaml");
    if (name) {
      const { readRegistry } = await import("./context/registry.js");
      const registry = readRegistry();
      const entry = registry.contexts.find((c) => c.name === name);
      if (!entry) {
        console.error(chalk.red(`Kontext "${name}" nicht in der Registry gefunden.`));
        process.exit(1);
      }
      const { readManifest } = await import("./context/manifest.js");
      const manifest = readManifest(entry.path);
      console.log(YAML.stringify(manifest));
    } else {
      const { readManifest, hasContext } = await import("./context/manifest.js");
      if (!hasContext(process.cwd())) {
        console.error(chalk.red("Kein AIOS-Kontext im aktuellen Verzeichnis."));
        console.error(chalk.gray("Erstelle mit: aios init"));
        process.exit(1);
      }
      const manifest = readManifest(process.cwd());
      console.log(YAML.stringify(manifest));
    }
  });

// ─── aios context link <target> ──────────────────────────
contextCmd
  .command("link <target>")
  .description("Verknüpfung zu anderem Kontext herstellen")
  .option("--relationship <rel>", "Beziehungstyp: audits | consults | feeds | depends_on", "consults")
  .action(async (target: string, opts) => {
    const validRelationships = ["audits", "consults", "feeds", "depends_on"];
    if (!validRelationships.includes(opts.relationship)) {
      console.error(chalk.red(`Ungültiger Beziehungstyp: "${opts.relationship}". Erlaubt: ${validRelationships.join(", ")}`));
      process.exit(1);
    }

    const { readManifest, writeManifest, hasContext } = await import("./context/manifest.js");
    const { readRegistry, registerContext } = await import("./context/registry.js");
    const { resolve } = await import("node:path");

    if (!hasContext(process.cwd())) {
      console.error(chalk.red("Kein AIOS-Kontext im aktuellen Verzeichnis."));
      process.exit(1);
    }

    const registry = readRegistry();
    let targetPath: string;
    let targetName: string;

    const byName = registry.contexts.find((c) => c.name === target);
    if (byName) {
      targetPath = byName.path;
      targetName = byName.name;
    } else if (hasContext(resolve(target))) {
      const targetManifest = readManifest(resolve(target));
      targetPath = resolve(target);
      targetName = targetManifest.name;
    } else {
      console.error(chalk.red(`Kontext "${target}" nicht gefunden (weder Name noch Pfad).`));
      process.exit(1);
    }

    const manifest = readManifest(process.cwd());

    if (manifest.links.some((l) => l.path === targetPath)) {
      console.error(chalk.yellow(`Bereits verknüpft mit "${targetName}".`));
      return;
    }

    manifest.links.push({
      name: targetName,
      path: targetPath,
      relationship: opts.relationship,
    });

    writeManifest(process.cwd(), manifest);
    registerContext(manifest, process.cwd());
    console.error(chalk.green(`✅ Verknüpft: ${manifest.name} → ${targetName} (${opts.relationship})`));
  });

// ─── aios context unlink <target> ────────────────────────
contextCmd
  .command("unlink <target>")
  .description("Verknüpfung zu anderem Kontext entfernen")
  .action(async (target: string) => {
    const { readManifest, writeManifest, hasContext } = await import("./context/manifest.js");
    const { registerContext } = await import("./context/registry.js");
    if (!hasContext(process.cwd())) {
      console.error(chalk.red("Kein AIOS-Kontext im aktuellen Verzeichnis."));
      process.exit(1);
    }

    const manifest = readManifest(process.cwd());
    const before = manifest.links.length;
    manifest.links = manifest.links.filter(
      (l) => l.name !== target && l.path !== target
    );

    if (manifest.links.length === before) {
      console.error(chalk.yellow(`Keine Verknüpfung zu "${target}" gefunden.`));
      return;
    }

    writeManifest(process.cwd(), manifest);
    registerContext(manifest, process.cwd());
    console.error(chalk.green(`✅ Verknüpfung zu "${target}" entfernt.`));
  });

// ─── aios context catalog ────────────────────────────────
contextCmd
  .command("catalog")
  .description("Federation-Katalog aller registrierten Kontexte anzeigen")
  .action(async () => {
    const { readRegistry } = await import("./context/registry.js");
    const registry = readRegistry();
    if (registry.contexts.length === 0) {
      console.error(chalk.yellow("Keine Kontexte in der Federation-Registry."));
      console.error(chalk.gray("Registriere mit: aios context scan <pfad>"));
      return;
    }
    for (const c of registry.contexts) {
      console.log(
        `${chalk.cyan(c.name.padEnd(25))} ${chalk.gray(c.type.padEnd(10))} ${c.description}`
      );
      console.log(chalk.gray(`  ${c.path}`));
      if (c.capabilities.length > 0) {
        console.log(chalk.gray(`  Capabilities: ${c.capabilities.join(", ")}`));
      }
      if (c.links?.length) {
        console.log(chalk.gray(`  Links: ${c.links.map((l: { name: string; relationship: string }) => `${l.name} (${l.relationship})`).join(", ")}`));
      }
      console.log();
    }
  });

// ─── aios context scan ──────────────────────────────────
contextCmd
  .command("scan [paths...]")
  .description("Dateisystem nach Kontexten durchsuchen und Registry aktualisieren")
  .option("--depth <n>", "Maximale Suchtiefe", "3")
  .action(async (paths: string[], opts) => {
    const { scanContexts } = await import("./context/scanner.js");
    const { getAiosHome } = await import("./utils/config.js");

    const searchPaths = paths.length > 0
      ? paths
      : [process.cwd(), getAiosHome()];

    const depth = parseInt(opts.depth, 10);
    console.error(chalk.gray("Scanne nach Kontexten..."));

    const result = scanContexts(searchPaths, Number.isNaN(depth) ? 3 : depth);

    console.error(chalk.green("✓ Scan abgeschlossen"));

    if (result.discovered.length > 0) {
      console.error(chalk.green(`\n  Neu entdeckt (${result.discovered.length}):`));
      for (const ctx of result.discovered) {
        console.error(chalk.green(`    + ${ctx.entry.name}`) + chalk.gray(` (${ctx.entry.type}) — ${ctx.entry.description}`));
        if (ctx.entry.capabilities.length > 0) {
          console.error(chalk.cyan(`      Fähigkeiten: ${ctx.entry.capabilities.join(", ")}`));
        }
        if (ctx.entry.links?.length) {
          console.error(chalk.gray(`      Links: ${ctx.entry.links.map((l) => `${l.name} (${l.relationship})`).join(", ")}`));
        }
        console.error(chalk.gray(`      Pfad: ${ctx.path}`));
      }
    }

    if (result.updated.length > 0) {
      console.error(chalk.blue(`\n  Aktualisiert (${result.updated.length}):`));
      for (const ctx of result.updated) {
        console.error(chalk.blue(`    ~ ${ctx.entry.name}`) + chalk.gray(` (${ctx.entry.type}) — ${ctx.entry.description}`));
        if (ctx.entry.capabilities.length > 0) {
          console.error(chalk.cyan(`      Fähigkeiten: ${ctx.entry.capabilities.join(", ")}`));
        }
      }
    }

    if (result.stale.length > 0) {
      console.error(chalk.yellow(`\n  Entfernt (nicht mehr vorhanden) (${result.stale.length}):`));
      for (const ctx of result.stale) {
        console.error(chalk.yellow(`    - ${ctx.name}`) + chalk.gray(` (${ctx.path})`));
      }
    }

    if (result.brokenLinks.length > 0) {
      console.error(chalk.red(`\n  Defekte Links (${result.brokenLinks.length}):`));
      for (const bl of result.brokenLinks) {
        console.error(chalk.red(`    ✗ ${bl.context} → ${bl.linkName} (${bl.path})`));
      }
    }

    const total = result.discovered.length + result.updated.length;
    console.error(chalk.gray(`\n  ${total} Kontext(e) in Registry, ${result.stale.length} entfernt, ${result.brokenLinks.length} defekte Links`));
  });

// ─── aios persona ───────────────────────────────────────
const personaCmd = program.command("persona").description("Persona-Verwaltung");

personaCmd
  .command("list")
  .description("Alle Personas auflisten")
  .action(() => {
    const config = loadConfig();
    const personas = new PersonaRegistry(config.paths.personas);
    const all = personas.all();
    if (all.length === 0) {
      console.error(chalk.yellow("Keine Personas gefunden."));
      return;
    }
    for (const p of all) {
      console.log(`  ${chalk.cyan(p.id.padEnd(20))} ${p.role} – ${chalk.gray(p.expertise.slice(0, 3).join(", "))}`);
    }
  });

personaCmd
  .command("validate [name]")
  .description("Persona gegen Base Trait Protocol validieren")
  .action(async (name?: string) => {
    const config = loadConfig();
    const personas = new PersonaRegistry(config.paths.personas);
    const { loadBaseTraits, validatePersona } = await import("./core/trait-validator.js");
    const traits = loadBaseTraits(config.paths.personas);
    if (!traits) {
      console.error(chalk.red("Base Traits nicht gefunden: personas/kernel/base_traits.yaml"));
      process.exit(1);
    }

    const toValidate = name
      ? [personas.get(name)].filter((p): p is NonNullable<typeof p> => Boolean(p))
      : personas.all();
    if (toValidate.length === 0) {
      console.error(chalk.red(name ? `Persona "${name}" nicht gefunden.` : "Keine Personas gefunden."));
      process.exit(1);
    }

    let allPassed = true;
    for (const persona of toValidate) {
      const report = validatePersona(persona.id, persona.system_prompt, traits);
      console.log(chalk.bold(`\n  ${persona.id} (${persona.role})`));
      for (const r of report.results) {
        const icon = r.found ? chalk.green("✓") : r.required ? chalk.red("✗") : chalk.yellow("~");
        console.log(`    ${icon} ${r.message}`);
      }
      if (!report.passed) allPassed = false;
    }
    console.log();
    if (!allPassed) {
      console.error(chalk.yellow("Tipp: Füge Handoff/Trace-Instruktionen zum system_prompt hinzu."));
    }
  });

// ─── aios knowledge ─────────────────────────────────────
const knowledgeCmd = program.command("knowledge").description("Knowledge Bus Verwaltung");

knowledgeCmd
  .command("publish")
  .description("Knowledge-Item über stdin veröffentlichen")
  .requiredOption("--type <type>", "Typ: decision, fact, requirement, artifact")
  .option("--tags <tags>", "Komma-getrennte Tags", "")
  .option("--pattern <name>", "Quell-Pattern", "manual")
  .option("--context <id>", "Context-ID", "default")
  .action(async (opts) => {
    const { KnowledgeBus } = await import("./core/knowledge-bus.js");
    const { randomUUID } = await import("crypto");
    const content = await readStdin();
    if (!content) { console.error(chalk.red("Kein Input via stdin.")); process.exit(1); }

    const bus = new KnowledgeBus(join(process.env.HOME ?? ".", ".aios", "knowledge", "bus.db"));
    const ctx = { trace_id: randomUUID(), context_id: opts.context, started_at: Date.now() };
    const id = bus.publish({
      type: opts.type,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : [],
      source_pattern: opts.pattern,
      content,
      format: "text",
      target_context: opts.context,
    }, ctx);

    console.log(chalk.green(`Knowledge published: ${id}`));
    bus.close();
  });

knowledgeCmd
  .command("query")
  .description("Knowledge abfragen")
  .option("--type <type>", "Typ filtern")
  .option("--tags <tags>", "Tags filtern (komma-getrennt)")
  .option("--pattern <name>", "Quell-Pattern filtern")
  .option("--context <id>", "Context-ID", "default")
  .option("--cross-context", "Cross-Context-Items einschließen")
  .option("--limit <n>", "Max Ergebnisse", "20")
  .action(async (opts) => {
    const { KnowledgeBus } = await import("./core/knowledge-bus.js");
    const { randomUUID } = await import("crypto");

    const bus = new KnowledgeBus(join(process.env.HOME ?? ".", ".aios", "knowledge", "bus.db"));
    const ctx = { trace_id: randomUUID(), context_id: opts.context, started_at: Date.now() };
    const results = bus.query({
      type: opts.type,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
      source_pattern: opts.pattern,
      limit: parseInt(opts.limit),
      include_cross_context: opts.crossContext,
    }, ctx);

    if (results.length === 0) {
      console.error(chalk.yellow("Keine Ergebnisse."));
    } else {
      for (const msg of results) {
        const date = new Date(msg.created_at).toISOString().slice(0, 19);
        console.log(chalk.gray(`[${date}]`) + ` ${chalk.cyan(msg.type)} ` + chalk.gray(`(${msg.source_pattern})`));
        console.log(`  ${msg.content.slice(0, 200)}${msg.content.length > 200 ? "..." : ""}`);
        if (msg.tags.length > 0) console.log(chalk.gray(`  Tags: ${msg.tags.join(", ")}`));
        console.log();
      }
    }
    bus.close();
  });

knowledgeCmd
  .command("search <query...>")
  .description("Volltextsuche im Knowledge Bus")
  .option("--context <id>", "Context-ID", "default")
  .option("--limit <n>", "Max Ergebnisse", "20")
  .action(async (queryParts: string[], opts) => {
    const { KnowledgeBus } = await import("./core/knowledge-bus.js");
    const { randomUUID } = await import("crypto");

    const bus = new KnowledgeBus(join(process.env.HOME ?? ".", ".aios", "knowledge", "bus.db"));
    const ctx = { trace_id: randomUUID(), context_id: opts.context, started_at: Date.now() };
    const results = bus.search(queryParts.join(" "), ctx, parseInt(opts.limit));

    if (results.length === 0) {
      console.error(chalk.yellow("Keine Treffer."));
    } else {
      for (const msg of results) {
        const date = new Date(msg.created_at).toISOString().slice(0, 19);
        console.log(chalk.gray(`[${date}]`) + ` ${chalk.cyan(msg.type)} ` + chalk.gray(`(${msg.source_pattern})`));
        console.log(`  ${msg.content.slice(0, 200)}${msg.content.length > 200 ? "..." : ""}`);
        console.log();
      }
    }
    bus.close();
  });

// ─── aios service ────────────────────────────────────────
const serviceCmd = program.command("service").description("Service Interface Verwaltung");

serviceCmd
  .command("init [path]")
  .description("Service-Interface für bestehenden Kontext einrichten")
  .action(async (contextPath?: string) => {
    const { initServiceInterface } = await import("./service/service-init.js");
    const cwd = contextPath ? join(process.cwd(), contextPath) : process.cwd();

    try {
      const result = initServiceInterface(cwd);

      if (!result.manifestCreated) {
        console.error(chalk.yellow(result.message));
        return;
      }

      console.error(chalk.green(`✅ ${result.message}`));

      if (result.dataFilesCreated.length > 0) {
        console.error(chalk.gray("\nErstellt Template-Dateien:"));
        for (const f of result.dataFilesCreated) {
          console.error(chalk.gray(`  → data/${f} (bitte mit echten Daten ersetzen)`));
        }
      }

      if (result.sourcesDetected.length > 0) {
        console.error(chalk.gray("\nErkannte Services:"));
        for (const s of result.sourcesDetected) {
          console.error(chalk.gray(`  → ${s.name}: ${s.description}`));
          if (s.key_fields?.length) {
            console.error(chalk.gray(`    key_fields: ${s.key_fields.join(", ")}`));
          }
        }
      }

      console.error(chalk.gray("\nNächste Schritte:"));
      console.error(chalk.gray("  1. Template-Daten in data/ mit echten Daten ersetzen"));
      console.error(chalk.gray("  2. data/manifest.yaml anpassen (key_fields, descriptions)"));
      console.error(chalk.gray("  3. 'aios service list' um Endpoints zu prüfen"));
    } catch (err) {
      console.error(chalk.red(`Fehler: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

serviceCmd
  .command("list")
  .description("Alle verfügbaren Service-Endpoints auflisten")
  .action(async () => {
    const { ServiceBus } = await import("./service/service-bus.js");
    const { getAiosHome } = await import("./utils/config.js");
    const bus = new ServiceBus(join(getAiosHome(), "knowledge", "services.db"));
    try {
      const endpoints = bus.discoverAll();

      if (endpoints.length === 0) {
        console.error(chalk.yellow("Keine Service-Endpoints gefunden."));
        console.error(chalk.gray("Erstelle data/manifest.yaml in einem Kontext-Verzeichnis."));
        return;
      }

      for (const ep of endpoints) {
        console.log(chalk.bold(`  ${ep.context}.${ep.name}`) + chalk.gray(`  ${ep.description} (${ep.record_count} records)`));
        console.log(chalk.gray(`    → key_fields: ${ep.key_fields.join(", ")}`));
        console.log(chalk.gray(`    → fields: ${ep.fields.map((f) => `${f.name}:${f.type}`).join(", ")}`));
      }
    } finally {
      bus.close();
    }
  });

serviceCmd
  .command("show <endpoint>")
  .description("Service-Endpoint Details anzeigen (Format: context.endpoint)")
  .action(async (endpointArg: string) => {
    const { ServiceBus } = await import("./service/service-bus.js");
    const { getAiosHome } = await import("./utils/config.js");

    const dotIdx = endpointArg.indexOf(".");
    if (dotIdx < 0) {
      console.error(chalk.red("Format: <context>.<endpoint> (z.B. hr.employees)"));
      process.exit(1);
    }

    const contextName = endpointArg.slice(0, dotIdx);
    const endpointName = endpointArg.slice(dotIdx + 1);

    const bus = new ServiceBus(join(getAiosHome(), "knowledge", "services.db"));
    try {
      const endpoints = bus.discoverForContext(contextName);
      const ep = endpoints.find((e) => e.name === endpointName);

      if (!ep) {
        console.error(chalk.red(`Endpoint "${endpointName}" nicht im Kontext "${contextName}" gefunden.`));
        const available = endpoints.map((e) => `${contextName}.${e.name}`).join(", ");
        if (available) console.error(chalk.gray(`Verfügbar: ${available}`));
        process.exit(1);
      }

      console.log(chalk.bold(`\nEndpoint: ${ep.context}.${ep.name}`));
      console.log(`Beschreibung: ${ep.description}`);
      console.log(`Datendatei: ${ep.data_file}`);
      console.log(`Datensätze: ${ep.record_count}`);
      console.log(`Key-Fields: ${ep.key_fields.join(", ")}`);
      console.log(chalk.bold("\nSchema:"));
      for (const field of ep.fields) {
        console.log(`  ${field.name}: ${field.type}${field.sample ? chalk.gray(` (z.B. "${field.sample}")`) : ""}`);
      }
    } finally {
      bus.close();
    }
  });

serviceCmd
  .command("call <endpoint> [input]")
  .description("Service-Endpoint aufrufen (Format: context.endpoint)")
  .option("--provider <name>", "Provider für LLM-Fallback überschreiben")
  .action(async (endpointArg: string, inputArg: string | undefined) => {
    const { ServiceBus } = await import("./service/service-bus.js");
    const { getAiosHome } = await import("./utils/config.js");
    const { randomUUID } = await import("crypto");

    const dotIdx = endpointArg.indexOf(".");
    if (dotIdx < 0) {
      console.error(chalk.red("Format: <context>.<endpoint> (z.B. hr.employees)"));
      process.exit(1);
    }

    const contextName = endpointArg.slice(0, dotIdx);
    const endpointName = endpointArg.slice(dotIdx + 1);

    // Read input from argument or stdin
    let inputStr = inputArg;
    if (!inputStr) {
      inputStr = await readStdin();
    }
    if (!inputStr) {
      console.error(chalk.red("Kein Input angegeben. Nutze: aios service call ctx.endpoint '{\"key\": \"value\"}'"));
      process.exit(1);
    }

    let query: Record<string, unknown>;
    try {
      query = JSON.parse(inputStr) as Record<string, unknown>;
    } catch {
      console.error(chalk.red("Input muss gültiges JSON sein."));
      process.exit(1);
    }

    const bus = new ServiceBus(join(getAiosHome(), "knowledge", "services.db"));
    const ctx = {
      trace_id: randomUUID(),
      context_id: "cli",
      started_at: Date.now(),
    };

    try {
      const result = await bus.call(contextName, endpointName, query, ctx);
      console.error(chalk.gray(`[${result.method}] ${result.results.length} Treffer (${result.durationMs}ms)`));
      console.log(JSON.stringify(result.results, null, 2));
    } catch (err) {
      console.error(chalk.red(`Fehler: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    } finally {
      bus.close();
    }
  });

serviceCmd
  .command("refresh [context]")
  .description("Service-Cache neu generieren")
  .action(async (contextName?: string) => {
    const { ServiceBus } = await import("./service/service-bus.js");
    const { getAiosHome } = await import("./utils/config.js");
    const bus = new ServiceBus(join(getAiosHome(), "knowledge", "services.db"));
    try {
      if (contextName) {
        const endpoints = bus.discoverForContext(contextName);
        console.log(chalk.green(`✅ ${endpoints.length} Endpoints für "${contextName}" neu generiert.`));
      } else {
        const endpoints = bus.discoverAll();
        console.log(chalk.green(`✅ ${endpoints.length} Endpoints insgesamt neu generiert.`));
      }
    } finally {
      bus.close();
    }
  });

// ─── aios patterns ───────────────────────────────────────
const patternsCmd = program.command("patterns").description("Pattern-Verwaltung");

// ─── aios patterns list [--category=X] ──────────────────
patternsCmd
  .command("list")
  .description("Alle Patterns auflisten")
  .option("--category <cat>", "Nach Kategorie filtern")
  .action(async (opts) => {
    const config = loadConfig();
    const registry = buildContextAwareRegistry(config.paths.patterns);
    const mcpManager = await setupMcp(config, registry);
    const patterns = opts.category
      ? registry.byCategory(opts.category)
      : registry.all();

    if (patterns.length === 0) {
      console.error(chalk.yellow("Keine Patterns gefunden."));
      if (opts.category) {
        console.error(chalk.gray("Kategorien: " + registry.categories().join(", ")));
      }
      return;
    }

    // Gruppiert nach Kategorie ausgeben
    const grouped = new Map<string, typeof patterns>();
    for (const p of patterns) {
      if (p.meta.internal) continue;
      const cat = p.meta.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(p);
    }

    for (const [cat, pats] of [...grouped.entries()].sort()) {
      console.log(chalk.bold.blue(`\n  ${cat.toUpperCase()}`));
      for (const p of pats) {
        const ver = p.meta.version ? chalk.gray(` v${p.meta.version}`) : "";
        const paramCount = p.meta.parameters?.length ?? 0;
        const paramHint = paramCount > 0 ? chalk.yellow(` [${paramCount} params]`) : "";
        const typeBadge = p.meta.type === "mcp" ? chalk.blue(" [MCP]") : p.meta.type === "tool" ? chalk.magenta(" [TOOL]") : p.meta.type === "rag" ? chalk.yellow(" [RAG]") : "";
        console.log(`    ${chalk.cyan(p.meta.name.padEnd(25))} ${p.meta.description}${ver}${paramHint}${typeBadge}`);
      }
    }
    console.log();
    await mcpManager?.shutdown();
  });

// ─── aios patterns search <query> ───────────────────────
patternsCmd
  .command("search <query...>")
  .description("Patterns durchsuchen (Name, Beschreibung, Tags)")
  .action(async (queryParts: string[]) => {
    const config = loadConfig();
    const registry = buildContextAwareRegistry(config.paths.patterns);
    const mcpManager = await setupMcp(config, registry);
    const results = registry.search(queryParts.join(" "));

    if (results.length === 0) {
      console.error(chalk.yellow("Keine Patterns gefunden."));
      return;
    }

    console.log(chalk.bold(`\n  ${results.length} Treffer:\n`));
    for (const p of results) {
      const tags = p.meta.tags.length > 0 ? chalk.gray(` [${p.meta.tags.join(", ")}]`) : "";
      console.log(`    ${chalk.cyan(p.meta.name.padEnd(25))} ${p.meta.description}${tags}`);
    }
    console.log();
    await mcpManager?.shutdown();
  });

// ─── aios patterns show <name> ──────────────────────────
patternsCmd
  .command("show <name>")
  .description("Pattern-Details anzeigen")
  .action(async (name: string) => {
    const config = loadConfig();
    const registry = buildContextAwareRegistry(config.paths.patterns);
    const mcpManager = await setupMcp(config, registry);
    const p = registry.get(name);
    if (!p) { console.error(chalk.red("Nicht gefunden.")); await mcpManager?.shutdown(); process.exit(1); }

    const typeBadge = p.meta.type === "mcp" ? chalk.blue(" [MCP]") : p.meta.type === "tool" ? chalk.magenta(" [TOOL]") : p.meta.type === "rag" ? chalk.yellow(" [RAG]") : "";
    console.log(chalk.bold(p.meta.name) + chalk.gray(` (${p.meta.category})`) + typeBadge);
    if (p.meta.version) console.log(chalk.gray(`Version: ${p.meta.version}`));
    console.log(chalk.gray(`${p.meta.description}\n`));

    if (p.meta.tags.length > 0) {
      console.log(chalk.gray(`Tags: ${p.meta.tags.join(", ")}`));
    }

    console.log(chalk.gray(`Input: ${p.meta.input_type} → Output: ${p.meta.output_type}`));

    if (p.meta.type === "mcp" && p.meta.mcp_server && p.meta.mcp_tool) {
      console.log(chalk.gray(`MCP-Server: ${p.meta.mcp_server} | Tool: ${p.meta.mcp_tool}`));
      if (p.meta.mcp_input_schema) {
        const schema = p.meta.mcp_input_schema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
        if (schema.properties) {
          console.log(chalk.bold("\nParameter (JSON):"));
          for (const [pName, prop] of Object.entries(schema.properties)) {
            const req = schema.required?.includes(pName) ? chalk.red("*") : "";
            console.log(`  ${pName}${req}: ${prop.type ?? "any"}`);
            if (prop.description) console.log(`    ${chalk.gray(prop.description)}`);
          }
        }
      }
    }

    if (p.meta.parameters?.length) {
      console.log(chalk.bold("\nParameter:"));
      for (const param of p.meta.parameters) {
        const vals = param.values ? ` (${param.values.join(" | ")})` : "";
        const def = param.default !== undefined ? ` [default: ${param.default}]` : "";
        console.log(`  --${param.name}${vals}${def}`);
        if (param.description) console.log(`    ${chalk.gray(param.description)}`);
      }
    }

    if (p.meta.can_follow?.length) console.log(chalk.gray(`\nFolgt auf: ${p.meta.can_follow.join(", ")}`));
    if (p.meta.can_precede?.length) console.log(chalk.gray(`Gefolgt von: ${p.meta.can_precede.join(", ")}`));
    if (p.meta.parallelizable_with?.length) console.log(chalk.gray(`Parallel mit: ${p.meta.parallelizable_with.join(", ")}`));

    if (p.meta.type !== "mcp") {
      console.log(chalk.bold("\n─── Prompt ───\n"));
      console.log(p.systemPrompt);
    }
    await mcpManager?.shutdown();
  });

// ─── aios patterns create <name> ────────────────────────
patternsCmd
  .command("create <name>")
  .description("Neues Pattern erstellen (Template)")
  .option("--category <cat>", "Kategorie", "custom")
  .option("--description <desc>", "Beschreibung", "")
  .action((name: string, opts) => {
    const config = loadConfig();
    const dir = join(config.paths.patterns, name);

    if (existsSync(dir)) {
      console.error(chalk.red(`Pattern "${name}" existiert bereits.`));
      process.exit(1);
    }

    mkdirSync(dir, { recursive: true });

    const template = `---
name: ${name}
version: "1.0"
description: "${opts.description || `Beschreibung für ${name}`}"
category: ${opts.category}
input_type: text
output_type: text
tags: []
---

# IDENTITY and PURPOSE

Du bist ein Experte für [Bereich]. [Beschreibung deiner Rolle und Expertise.]

# STEPS

1. [Erster Schritt]
2. [Zweiter Schritt]
3. [Dritter Schritt]

# OUTPUT FORMAT

[Beschreibung des gewünschten Output-Formats]

# INPUT
`;

    writeFileSync(join(dir, "system.md"), template, "utf-8");
    console.log(chalk.green(`Pattern "${name}" erstellt: ${join(dir, "system.md")}`));
    console.log(chalk.gray("Bearbeite die Datei um den Prompt anzupassen."));
  });

// ─── aios init ──────────────────────────────────────────
program
  .command("init")
  .description("Initialize .aios/ project context (interactive wizard)")
  .option("--quick", "Auto-detect everything, no questions")
  .option("--yes", "Show plan and auto-confirm")
  .option("--refresh", "Regenerate agent-instructions.md from existing context.yaml")
  .option("--aios-path <path>", "Pre-set AIOS installation path")
  .action(async (opts) => {
    const cwd = process.cwd();
    const { existsSync: exists } = await import("fs");
    const { join: pJoin } = await import("path");

    // ─── Refresh mode: regenerate from existing context.yaml ───
    if (opts.refresh) {
      const { generate } = await import("./init/generator.js");
      try {
        const result = generate({} as never, { refresh: true, cwd });
        console.error(chalk.green("  ✓ Regenerated:"));
        for (const f of result.modified) console.error(chalk.gray(`    ${f}`));
        process.exit(0);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    }

    // ─── Re-init detection ──────────────────────────────────
    if (exists(pJoin(cwd, ".aios", "context.yaml"))) {
      if (opts.quick) {
        // Quick mode: just refresh
        const { generate } = await import("./init/generator.js");
        const result = generate({} as never, { refresh: true, cwd });
        console.error(chalk.green("  ✓ Refreshed from existing context.yaml"));
        for (const f of result.modified) console.error(chalk.gray(`    ${f}`));
        process.exit(0);
      }

      console.error(chalk.yellow("  ⚠ .aios/ already exists in this directory."));
      console.error(chalk.gray("    1) Refresh — regenerate agent-instructions.md from existing context.yaml"));
      console.error(chalk.gray("    2) Reconfigure — re-run wizard (keeps pattern overrides)"));
      console.error(chalk.gray("    3) Abort"));

      const { createInterface } = await import("readline");
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const answer = await new Promise<string>((resolve) => {
        rl.question("  Choice [1]: ", (a) => { resolve(a.trim() || "1"); rl.close(); });
      });

      if (answer === "1") {
        const { generate } = await import("./init/generator.js");
        const result = generate({} as never, { refresh: true, cwd });
        console.error(chalk.green("  ✓ Refreshed:"));
        for (const f of result.modified) console.error(chalk.gray(`    ${f}`));
        process.exit(0);
      } else if (answer === "3") {
        console.error(chalk.yellow("  Aborted."));
        process.exit(2);
      }
      // answer === "2": fall through to full wizard
    }

    // ─── Full wizard flow ───────────────────────────────────
    const { scanProject } = await import("./init/scanner.js");
    const { runWizard } = await import("./init/wizard.js");
    const { generate } = await import("./init/generator.js");

    const scan = scanProject(cwd);
    const context = await runWizard(scan, cwd, {
      quick: opts.quick,
      yes: opts.yes,
      aiosPath: opts.aiosPath,
    });

    if (!context) {
      process.exit(2); // user cancelled
    }

    const result = generate(context, {
      cwd,
      skipClaudeMdPrompt: false,
      patchClaudeMd: true,
    });

    // ─── Register in federation registry (best-effort) ──────
    try {
      const { registerContext } = await import("./context/registry.js");
      registerContext(context, cwd);
    } catch {
      // Registry registration is best-effort
    }

    // ─── Summary ────────────────────────────────────────────
    console.error();
    console.error(chalk.green("  ✓ Project initialized!"));
    if (result.created.length > 0) {
      console.error(chalk.cyan("  Created:"));
      for (const f of result.created) console.error(chalk.gray(`    ${f}`));
    }
    if (result.modified.length > 0) {
      console.error(chalk.cyan("  Modified:"));
      for (const f of result.modified) console.error(chalk.gray(`    ${f}`));
    }
    console.error();
    console.error(chalk.gray("  Next steps:"));
    console.error(chalk.gray('    aios "describe your task"    # start working'));
    console.error(chalk.gray("    aios init --refresh          # regenerate after editing context.yaml"));
    console.error();
  });

// ─── aios quality ──────────────────────────────────────
const qualityCmd = program.command("quality").description("Quality Backbone Verwaltung");

qualityCmd
  .command("status")
  .description("Quality Level und aktive Policies anzeigen")
  .action(() => {
    const config = loadConfig();
    const qualityConfig = config.quality;

    if (!qualityConfig) {
      console.log(chalk.yellow("Quality Backbone: nicht konfiguriert"));
      console.log(chalk.gray("Konfiguriere in aios.yaml unter 'quality:' oder nutze --quality=<level>"));
      return;
    }

    console.log(chalk.bold(`Quality Level: ${qualityConfig.level}`));

    // Determine active policies based on level
    const level = qualityConfig.level;
    const policies: string[] = [];
    if (qualityConfig.policies.self_check?.enabled !== false) policies.push("self_check");
    if (level !== "minimal") {
      if (qualityConfig.policies.consistency_check?.enabled !== false) policies.push("consistency_check");
      if (qualityConfig.policies.peer_review?.enabled !== false) policies.push("peer_review");
    }
    if (level === "regulated") {
      if (qualityConfig.policies.compliance_check?.enabled !== false) policies.push("compliance_check");
      if (qualityConfig.policies.traceability_check?.enabled !== false) policies.push("traceability_check");
      if (qualityConfig.policies.quality_gate?.enabled !== false) policies.push("quality_gate");
    }

    console.log(chalk.gray(`Active Policies: ${policies.join(", ")}`));
    console.log(chalk.gray(`Audit Trail: ${qualityConfig.audit?.enabled ? `enabled (${qualityConfig.audit.output_dir ?? ".aios/audit/"})` : "disabled"}`));

    // Boundaries
    const boundaries = qualityConfig.boundaries ?? {};
    const activeBoundaries = Object.entries(boundaries).filter(([, v]) => v).map(([k]) => k);
    if (activeBoundaries.length > 0) {
      console.log(chalk.gray(`Boundaries: ${activeBoundaries.join(", ")}`));
    }
  });

qualityCmd
  .command("policies")
  .description("Alle verfügbaren Policies und deren Level anzeigen")
  .action(() => {
    const policyInfo = [
      { name: "self_check", level: "minimal", desc: "LLM-based self-validation" },
      { name: "consistency_check", level: "standard", desc: "Consistency against Knowledge Base" },
      { name: "peer_review", level: "standard", desc: "Review by counter-persona" },
      { name: "compliance_check", level: "regulated", desc: "Standards compliance (IEC 62443, CRA)" },
      { name: "traceability_check", level: "regulated", desc: "Requirements coverage check" },
      { name: "quality_gate", level: "regulated", desc: "Aggregate gate with blocking" },
    ];

    console.log(chalk.bold("\nQuality Policies:\n"));
    for (const p of policyInfo) {
      const levelColor = p.level === "minimal" ? chalk.green : p.level === "standard" ? chalk.yellow : chalk.red;
      console.log(`  ${chalk.cyan(p.name.padEnd(25))} ${levelColor(`[${p.level}]`.padEnd(12))} ${chalk.gray(p.desc)}`);
    }
    console.log();
  });

// ─── aios configure ──────────────────────────────────────
program
  .command("configure")
  .alias("config")
  .description("Interaktiver Setup-Wizard für Provider und API Keys")
  .action(async () => {
    const { runConfigure } = await import("./commands/configure.js");
    await runConfigure();
  });

// ─── aios update ────────────────────────────────────────
program
  .command("update")
  .description("AIOS auf die neueste Version aktualisieren")
  .option("--check", "Nur prüfen ob Updates verfügbar sind")
  .action(async (opts) => {
    const { runUpdate } = await import("./commands/update.js");
    await runUpdate(opts);
  });

// ─── aios mcp-server ─────────────────────────────────────
program
  .command("mcp-server")
  .description("AIOS als MCP-Server starten (stdio transport)")
  .action(async () => {
    const { startMCPServer } = await import("./mcp/server.js");
    await startMCPServer();
  });

// ─── Helper ─────────────────────────────────────────────

/** Parsed --key=value und --key value aus CLI-Args */
function parsePatternParams(args: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      params[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      params[arg.slice(2)] = args[++i];
    }
  }
  return params;
}

program.parse();
