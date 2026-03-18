import { createInterface } from "readline";
import { randomUUID } from "crypto";
import chalk from "chalk";
import type { ChatSession, ChatMessage, AiosConfig } from "../types.js";
import type { LLMProvider } from "../agents/provider.js";
import type { PatternRegistry } from "./registry.js";
import type { PersonaRegistry } from "./personas.js";
import type { Router } from "./router.js";
import type { Engine } from "./engine.js";
import { parseSlashCommand, isBuiltinCommand } from "./slash.js";

export interface ReplOptions {
  provider: LLMProvider;
  registry: PatternRegistry;
  personas: PersonaRegistry;
  router: Router;
  engine: Engine;
  config: AiosConfig;
}

const MAX_HISTORY_MESSAGES = 50;

function buildChatSystemPrompt(registry: PatternRegistry): string {
  const patternList = registry
    .all()
    .filter((p) => !p.meta.internal)
    .map((p) => `  /${p.meta.name} – ${p.meta.description}`)
    .join("\n");

  return `Du bist AIOS, ein AI-Orchestrierungssystem. Du hilfst dem Nutzer mit Aufgaben und kannst spezialisierte Patterns ausführen.

Verfügbare Patterns (der Nutzer kann diese mit /name aufrufen):
${patternList}

Wenn der Nutzer eine Aufgabe beschreibt die zu einem Pattern passt, weise ihn darauf hin.
Antworte in der Sprache des Nutzers.`;
}

function printWelcome(registry: PatternRegistry): void {
  const count = registry.all().filter((p) => !p.meta.internal).length;
  console.error(chalk.bold.blue("\n  AIOS Interactive Chat"));
  console.error(chalk.gray(`  ${count} Patterns geladen. Tippe /help für Befehle.\n`));
}

function printHelp(registry: PatternRegistry): void {
  console.error(chalk.bold("\n  Befehle:"));
  console.error(`    ${chalk.cyan("/help")}        Hilfe anzeigen`);
  console.error(`    ${chalk.cyan("/patterns")}    Alle Patterns auflisten`);
  console.error(`    ${chalk.cyan("/history")}     Chat-Verlauf anzeigen`);
  console.error(`    ${chalk.cyan("/clear")}       Chat-Verlauf löschen`);
  console.error(`    ${chalk.cyan("/exit")}        Session beenden`);
  console.error(chalk.bold("\n  Pattern-Ausführung:"));
  console.error(`    ${chalk.cyan("/<pattern>")} ${chalk.gray("[text] [--key=value]")}`);
  console.error(chalk.gray(`    z.B. /summarize Mein Text hier --language=de`));
  console.error(chalk.bold("\n  Natürliche Sprache:"));
  console.error(chalk.gray("    Einfach lostippen – AIOS antwortet im Chat.\n"));
}

function printHistory(session: ChatSession): void {
  if (session.messages.length === 0) {
    console.error(chalk.gray("\n  Kein Verlauf.\n"));
    return;
  }
  console.error(chalk.bold("\n  Chat-Verlauf:\n"));
  for (const msg of session.messages) {
    const prefix = msg.role === "user" ? chalk.green("  Du:") : chalk.blue("  AIOS:");
    const source = msg.source && msg.source !== "chat" ? chalk.gray(` [${msg.source}]`) : "";
    const lines = msg.content.split("\n");
    console.error(`${prefix}${source} ${lines[0]}`);
    for (const line of lines.slice(1)) {
      console.error(`        ${line}`);
    }
  }
  console.error();
}

function printPatterns(registry: PatternRegistry): void {
  const grouped = new Map<string, Array<{ name: string; desc: string }>>();
  for (const p of registry.all()) {
    if (p.meta.internal) continue;
    const cat = p.meta.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push({ name: p.meta.name, desc: p.meta.description });
  }
  for (const [cat, pats] of [...grouped.entries()].sort()) {
    console.error(chalk.bold.blue(`\n  ${cat.toUpperCase()}`));
    for (const p of pats) {
      console.error(`    ${chalk.cyan(`/${p.name}`.padEnd(28))} ${p.desc}`);
    }
  }
  console.error();
}

async function executePattern(
  name: string,
  args: string,
  params: Record<string, string>,
  options: ReplOptions,
): Promise<string> {
  const pattern = options.registry.get(name);
  if (!pattern) {
    throw new Error(`Pattern "${name}" nicht gefunden.`);
  }

  let systemPrompt = pattern.systemPrompt;

  // Inject params
  if (Object.keys(params).length > 0) {
    const paramBlock = Object.entries(params)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n");
    systemPrompt += `\n\n## PARAMETER\n\n${paramBlock}`;
  }

  // Combine with persona
  const persona = pattern.meta.persona ? options.personas.get(pattern.meta.persona) : undefined;
  const fullPrompt = persona
    ? `${persona.system_prompt}\n\n---\n\n${systemPrompt}`
    : systemPrompt;

  const input = args || "Keine Eingabe.";

  console.error(chalk.blue(`  ⏳ Führe Pattern ${chalk.cyan(name)} aus...`));
  const response = await options.provider.complete(fullPrompt, input);
  console.error(chalk.green(`  ✅ Fertig (${response.tokensUsed.input + response.tokensUsed.output} Tokens)`));

  return response.content;
}

async function handleChatTurn(
  userMessage: string,
  session: ChatSession,
  systemPrompt: string,
  options: ReplOptions,
): Promise<string> {
  // Build messages for provider (sliding window)
  const historyMessages = session.messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));

  historyMessages.push({ role: "user" as const, content: userMessage });

  console.error(chalk.blue("  ⏳ Denke nach..."));
  const response = await options.provider.chat(systemPrompt, historyMessages);
  console.error(chalk.green(`  ✅ (${response.tokensUsed.input + response.tokensUsed.output} Tokens)`));

  return response.content;
}

function question(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
    rl.once("close", () => resolve(null));
  });
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const session: ChatSession = {
    id: randomUUID(),
    messages: [],
    provider: options.config.defaults.provider,
  };

  const systemPrompt = buildChatSystemPrompt(options.registry);

  printWelcome(options.registry);

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr, // prompt goes to stderr (Unix convention)
    terminal: true,
  });

  const prompt = chalk.green("aios> ");

  while (true) {
    const line = await question(rl, prompt);
    if (line === null) break; // Ctrl+D

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Slash command?
    if (trimmed.startsWith("/")) {
      const cmd = parseSlashCommand(trimmed);
      if (!cmd) continue;

      if (isBuiltinCommand(cmd.name)) {
        switch (cmd.name) {
          case "help":
            printHelp(options.registry);
            break;
          case "patterns":
            printPatterns(options.registry);
            break;
          case "history":
            printHistory(session);
            break;
          case "clear":
            session.messages.length = 0;
            console.error(chalk.gray("  Verlauf gelöscht.\n"));
            break;
          case "exit":
          case "quit":
            console.error(chalk.gray("\n  Bis bald!\n"));
            rl.close();
            return;
        }
        continue;
      }

      // Pattern execution
      try {
        const result = await executePattern(cmd.name, cmd.args, cmd.params, options);
        // Add to history so user can reference it
        session.messages.push({ role: "user", content: `/${cmd.name} ${cmd.args}`.trim(), source: `pattern:${cmd.name}` });
        session.messages.push({ role: "assistant", content: result, source: `pattern:${cmd.name}` });
        // Output to stdout (pipeable)
        process.stdout.write(result + "\n");
      } catch (err) {
        console.error(chalk.red(`  ${err instanceof Error ? err.message : err}`));
      }
      continue;
    }

    // Natural language chat
    try {
      const response = await handleChatTurn(trimmed, session, systemPrompt, options);
      session.messages.push({ role: "user", content: trimmed, source: "chat" });
      session.messages.push({ role: "assistant", content: response, source: "chat" });
      process.stdout.write(response + "\n");
    } catch (err) {
      console.error(chalk.red(`  Fehler: ${err instanceof Error ? err.message : err}`));
    }
  }

  console.error(chalk.gray("\n  Bis bald!\n"));
  rl.close();
}
