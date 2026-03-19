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
import { ProviderSelector } from "./agents/provider-selector.js";
import { RAGService } from "./rag/rag-service.js";
import { loadConfig } from "./utils/config.js";
import { readStdin } from "./utils/stdin.js";
import { startRepl } from "./core/repl.js";
import type { AiosConfig, Pattern } from "./types.js";
import type { LLMProvider } from "./agents/provider.js";

/** Build all providers and a ProviderSelector from config */
function buildProviderSelector(config: AiosConfig): ProviderSelector {
  const allProviders = new Map<string, LLMProvider>();
  for (const [name, cfg] of Object.entries(config.providers)) {
    try { allProviders.set(name, createProvider(cfg)); } catch { /* skip unconfigured */ }
  }
  return new ProviderSelector(allProviders, config.providers);
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
  .action(async (taskParts: string[], opts) => {
    const stdinInput = await readStdin();
    const task = taskParts.join(" ");
    if (!task && !stdinInput) { program.help(); return; }

    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
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
    const engine = new Engine(registry, provider, config, personas, mcpManager, ragService, selector);
    const fullInput = [task, stdinInput].filter(Boolean).join("\n\n");

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
      if (output.outputType === "file" && output.filePath) {
        console.error(chalk.green(`\n📁 Datei erzeugt: ${output.filePath}`));
      }
      process.stdout.write(output.output);
    }
    await mcpManager?.shutdown();
  });

// ─── aios run <pattern> (Fabric-Style, mit Parametern) ───
program
  .command("run <pattern>")
  .description("Ein Pattern direkt ausführen (stdin → LLM → stdout)")
  .option("--provider <name>", "LLM Provider überschreiben")
  .allowUnknownOption(true)
  .action(async (patternName: string, _opts, cmd: Command) => {
    const input = await readStdin();
    if (!input) {
      console.error(chalk.red(`Kein Input. Nutze: echo "text" | aios run ${patternName}`));
      process.exit(1);
    }

    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
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
      if (out) process.stdout.write(out.output);
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
      if (out) process.stdout.write(out.output);
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
        if (out.outputType === "file" && out.filePath) {
          console.error(chalk.green(`📁 Datei erzeugt: ${out.filePath}`));
        }
        process.stdout.write(out.output);
      }
    } else {
      // LLM-Pattern: Persona + Pattern kombinieren
      const personaId = pattern.meta.persona;
      const persona = personaId ? personas.get(personaId) : undefined;
      const fullPrompt = persona
        ? `${persona.system_prompt}\n\n---\n\n${systemPrompt}`
        : systemPrompt;
      const response = await provider.complete(fullPrompt, input);
      process.stdout.write(response.content);
    }
    await mcpManager?.shutdown();
  });

// ─── aios plan (nur planen) ──────────────────────────────
program
  .command("plan <task...>")
  .description("Workflow planen ohne auszuführen")
  .option("--provider <name>", "LLM Provider überschreiben")
  .action(async (taskParts: string[], opts) => {
    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
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
    const registry = new PatternRegistry(config.paths.patterns);
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
  .action((name?: string) => {
    const config = loadConfig();
    const personas = new PersonaRegistry(config.paths.personas);
    const { loadBaseTraits, validatePersona } = await import("./core/trait-validator.js");
    const traits = loadBaseTraits(config.paths.personas);
    if (!traits) {
      console.error(chalk.red("Base Traits nicht gefunden: personas/kernel/base_traits.yaml"));
      process.exit(1);
    }

    const toValidate = name ? [personas.get(name)].filter(Boolean) : personas.all();
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

// ─── aios patterns ───────────────────────────────────────
const patternsCmd = program.command("patterns").description("Pattern-Verwaltung");

// ─── aios patterns list [--category=X] ──────────────────
patternsCmd
  .command("list")
  .description("Alle Patterns auflisten")
  .option("--category <cat>", "Nach Kategorie filtern")
  .action(async (opts) => {
    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
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
    const registry = new PatternRegistry(config.paths.patterns);
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
    const registry = new PatternRegistry(config.paths.patterns);
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
