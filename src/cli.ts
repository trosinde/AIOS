#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { PatternRegistry } from "./core/registry.js";
import { Router } from "./core/router.js";
import { Engine } from "./core/engine.js";
import { createProvider } from "./agents/provider.js";
import { loadConfig } from "./utils/config.js";
import { readStdin } from "./utils/stdin.js";

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
    const providerName = opts.provider || config.defaults.provider;
    const providerCfg = config.providers[providerName];
    if (!providerCfg) {
      console.error(chalk.red(`Provider "${providerName}" nicht gefunden.`));
      console.error(chalk.gray("Verfügbar: " + Object.keys(config.providers).join(", ")));
      process.exit(1);
    }
    const provider = createProvider(providerCfg);
    const router = new Router(registry, provider);
    const engine = new Engine(registry, provider, config);
    const fullInput = [task, stdinInput].filter(Boolean).join("\n\n");

    console.error(chalk.blue("🧠 Analysiere Aufgabe..."));
    const plan = await router.planWorkflow(fullInput);

    console.error(chalk.blue(`📋 Plan: ${plan.plan.type} (${plan.plan.steps.length} Schritte)`));
    for (const s of plan.plan.steps) {
      const pat = registry.get(s.pattern);
      const typeBadge = pat?.meta.type === "tool" ? chalk.magenta(" [TOOL]") : "";
      const par = s.parallel_group ? chalk.green(` [∥ ${s.parallel_group}]`) : "";
      console.error(`   ${s.id} → ${chalk.cyan(s.pattern)}${typeBadge}${par}`);
    }

    if (opts.dryRun) { console.log(JSON.stringify(plan, null, 2)); return; }

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
  });

// ─── aios run <pattern> (Fabric-Style, mit Parametern) ───
program
  .command("run <pattern>")
  .description("Ein Pattern direkt ausführen (stdin → LLM → stdout)")
  .allowUnknownOption(true)
  .action(async (patternName: string, _opts, cmd: Command) => {
    const input = await readStdin();
    if (!input) {
      console.error(chalk.red(`Kein Input. Nutze: echo "text" | aios run ${patternName}`));
      process.exit(1);
    }

    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
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

    if (pattern.meta.type === "tool") {
      // Tool-Pattern: Über Engine ausführen (mit Allowlist-Check)
      const provider = createProvider(config.providers[config.defaults.provider]);
      const engine = new Engine(registry, provider, config);
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
      // LLM-Pattern
      const provider = createProvider(config.providers[config.defaults.provider]);
      const response = await provider.complete(systemPrompt, input);
      process.stdout.write(response.content);
    }
  });

// ─── aios plan (nur planen) ──────────────────────────────
program
  .command("plan <task...>")
  .description("Workflow planen ohne auszuführen")
  .action(async (taskParts: string[]) => {
    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
    const provider = createProvider(config.providers[config.defaults.provider]);
    const router = new Router(registry, provider);
    const plan = await router.planWorkflow(taskParts.join(" "));
    console.log(JSON.stringify(plan, null, 2));
  });

// ─── aios patterns ───────────────────────────────────────
const patternsCmd = program.command("patterns").description("Pattern-Verwaltung");

// ─── aios patterns list [--category=X] ──────────────────
patternsCmd
  .command("list")
  .description("Alle Patterns auflisten")
  .option("--category <cat>", "Nach Kategorie filtern")
  .action((opts) => {
    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
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
        console.log(`    ${chalk.cyan(p.meta.name.padEnd(25))} ${p.meta.description}${ver}${paramHint}`);
      }
    }
    console.log();
  });

// ─── aios patterns search <query> ───────────────────────
patternsCmd
  .command("search <query...>")
  .description("Patterns durchsuchen (Name, Beschreibung, Tags)")
  .action((queryParts: string[]) => {
    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
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
  });

// ─── aios patterns show <name> ──────────────────────────
patternsCmd
  .command("show <name>")
  .description("Pattern-Details anzeigen")
  .action((name: string) => {
    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
    const p = registry.get(name);
    if (!p) { console.error(chalk.red("Nicht gefunden.")); process.exit(1); }

    console.log(chalk.bold(p.meta.name) + chalk.gray(` (${p.meta.category})`));
    if (p.meta.version) console.log(chalk.gray(`Version: ${p.meta.version}`));
    console.log(chalk.gray(`${p.meta.description}\n`));

    if (p.meta.tags.length > 0) {
      console.log(chalk.gray(`Tags: ${p.meta.tags.join(", ")}`));
    }

    console.log(chalk.gray(`Input: ${p.meta.input_type} → Output: ${p.meta.output_type}`));

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

    console.log(chalk.bold("\n─── Prompt ───\n"));
    console.log(p.systemPrompt);
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
