#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
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
    const engine = new Engine(registry, provider);
    const fullInput = [task, stdinInput].filter(Boolean).join("\n\n");

    console.error(chalk.blue("🧠 Analysiere Aufgabe..."));
    const plan = await router.planWorkflow(fullInput);

    console.error(chalk.blue(`📋 Plan: ${plan.plan.type} (${plan.plan.steps.length} Schritte)`));
    for (const s of plan.plan.steps) {
      const par = s.parallel_group ? chalk.green(` [∥ ${s.parallel_group}]`) : "";
      console.error(`   ${s.id} → ${chalk.cyan(s.pattern)}${par}`);
    }

    if (opts.dryRun) { console.log(JSON.stringify(plan, null, 2)); return; }

    console.error(chalk.blue("\n⚡ Starte...\n"));
    const result = await engine.execute(plan, fullInput);

    const lastStep = plan.plan.steps[plan.plan.steps.length - 1];
    const output = result.results.get(lastStep.id);
    if (output) process.stdout.write(output.output);
  });

// ─── aios run <pattern> (Fabric-Style) ───────────────────
program
  .command("run <pattern>")
  .description("Ein Pattern direkt ausführen (stdin → LLM → stdout)")
  .action(async (patternName: string) => {
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

    const provider = createProvider(config.providers[config.defaults.provider]);
    const response = await provider.complete(pattern.systemPrompt, input);
    process.stdout.write(response.content);
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

// ─── aios patterns list ──────────────────────────────────
const patternsCmd = program.command("patterns").description("Pattern-Verwaltung");

patternsCmd
  .command("list")
  .description("Alle Patterns auflisten")
  .action(() => {
    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
    for (const p of registry.all()) {
      if (p.meta.internal) continue;
      console.log(`${chalk.cyan(p.meta.name.padEnd(25))} ${chalk.gray(p.meta.category.padEnd(12))} ${p.meta.description}`);
    }
  });

patternsCmd
  .command("show <name>")
  .description("Pattern-Prompt anzeigen")
  .action((name: string) => {
    const config = loadConfig();
    const registry = new PatternRegistry(config.paths.patterns);
    const p = registry.get(name);
    if (!p) { console.error(chalk.red("Nicht gefunden.")); process.exit(1); }
    console.log(chalk.bold(p.meta.name) + chalk.gray(` (${p.meta.category})`));
    console.log(chalk.gray(`${p.meta.description}\n`));
    console.log(p.systemPrompt);
  });

program.parse();
