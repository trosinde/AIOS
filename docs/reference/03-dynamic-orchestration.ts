// ============================================================
// AIOS Dynamic Orchestration
// ============================================================
//
// Der komplette Ablauf:
//
//   User-Input
//     → Pattern Registry (Katalog laden)
//     → Router (LLM entscheidet den Plan)
//     → Engine (führt Plan mechanisch aus)
//     → Output
//
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const client = new Anthropic();
const AIOS_HOME = join(homedir(), ".aios");
const PATTERNS_DIR = join(AIOS_HOME, "patterns");

// ═══════════════════════════════════════════════════════════
// TEIL 1: Pattern Registry
// ═══════════════════════════════════════════════════════════
//
// Liest alle system.md Dateien, extrahiert das YAML-Frontmatter
// und baut einen Katalog den der Router versteht.

interface PatternMeta {
  name: string;
  description: string;
  category: string;
  input_type: string;
  output_type: string;
  tags: string[];
  needs_context?: string[];
  can_follow?: string[];
  can_precede?: string[];
  parallelizable_with?: string[];
  persona?: string;
  preferred_provider?: string;
  internal?: boolean;
}

interface Pattern {
  meta: PatternMeta;
  systemPrompt: string;    // Der volle Prompt (ohne Frontmatter)
  rawFile: string;          // Der volle Dateiinhalt
}

/**
 * Liest eine system.md und trennt YAML-Frontmatter vom Prompt.
 *
 * Eine system.md sieht so aus:
 *
 *   ---
 *   name: code_review
 *   description: "..."
 *   category: review
 *   ---
 *
 *   # IDENTITY and PURPOSE
 *   Du bist ein Senior Code Reviewer...
 *
 * Die Funktion gibt beides getrennt zurück.
 */
function parsePatternFile(filePath: string): Pattern {
  const raw = readFileSync(filePath, "utf-8");

  // Frontmatter extrahieren: Alles zwischen --- und ---
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // Kein Frontmatter → Fabric-kompatibles Pattern (nur Prompt)
    const name = filePath.split("/").slice(-2, -1)[0];
    return {
      meta: {
        name,
        description: "No description",
        category: "uncategorized",
        input_type: "text",
        output_type: "text",
        tags: [],
      },
      systemPrompt: raw,
      rawFile: raw,
    };
  }

  // Einfaches YAML-Parsing (für die Grundstruktur reicht das)
  const yamlStr = frontmatterMatch[1];
  const prompt = frontmatterMatch[2].trim();
  const meta = parseSimpleYaml(yamlStr);

  return { meta: meta as PatternMeta, systemPrompt: prompt, rawFile: raw };
}

function parseSimpleYaml(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      let value: any = match[2].trim();
      // Arrays: [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((s: string) => s.trim());
      }
      // Booleans
      if (value === "true") value = true;
      if (value === "false") value = false;
      // Quoted strings
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      result[match[1]] = value;
    }
  }
  return result;
}

/**
 * Lädt ALLE Patterns und baut den Registry-Katalog.
 */
function loadRegistry(): Map<string, Pattern> {
  const registry = new Map<string, Pattern>();

  if (!existsSync(PATTERNS_DIR)) return registry;

  for (const dir of readdirSync(PATTERNS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const systemPath = join(PATTERNS_DIR, dir.name, "system.md");
    if (!existsSync(systemPath)) continue;

    const pattern = parsePatternFile(systemPath);
    registry.set(pattern.meta.name, pattern);
  }

  return registry;
}

/**
 * Baut den kompakten Katalog-Text den der Router als Input bekommt.
 * NUR die Metadaten, nicht die vollen Prompts.
 */
function buildCatalogText(registry: Map<string, Pattern>): string {
  const lines: string[] = ["VERFÜGBARE PATTERNS:\n"];

  let i = 1;
  for (const [name, pattern] of registry) {
    // Interne Patterns (wie _router) nicht im Katalog zeigen
    if (pattern.meta.internal) continue;

    lines.push(`${i}. ${name}`);
    lines.push(`   Beschreibung: ${pattern.meta.description}`);
    lines.push(`   Input: ${pattern.meta.input_type} → Output: ${pattern.meta.output_type}`);
    lines.push(`   Kategorie: ${pattern.meta.category}`);
    lines.push(`   Tags: ${pattern.meta.tags?.join(", ") || "keine"}`);

    if (pattern.meta.persona) {
      lines.push(`   Persona: ${pattern.meta.persona}`);
    }
    if (pattern.meta.parallelizable_with?.length) {
      lines.push(`   Parallel mit: ${pattern.meta.parallelizable_with.join(", ")}`);
    }
    if (pattern.meta.needs_context?.length) {
      lines.push(`   Braucht Kontext von: ${pattern.meta.needs_context.join(", ")}`);
    }
    if (pattern.meta.can_follow?.length) {
      lines.push(`   Folgt typisch auf: ${pattern.meta.can_follow.join(", ")}`);
    }
    lines.push("");
    i++;
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════
// TEIL 2: Der Router (Meta-Agent)
// ═══════════════════════════════════════════════════════════
//
// Ein LLM-Call der die Aufgabe analysiert und einen
// Execution Plan als JSON zurückgibt.

interface ExecutionStep {
  id: string;
  pattern: string;
  persona?: string;
  depends_on: string[];
  input_from: string[];       // Step-IDs oder "$USER_INPUT"
  parallel_group?: string;
  retry?: {
    max: number;
    on_failure?: "retry_with_feedback" | "escalate";
    escalate_to?: string;
  };
  quality_gate?: {
    pattern: string;
    min_score: number;
  };
}

interface ExecutionPlan {
  analysis: {
    goal: string;
    complexity: "low" | "medium" | "high";
    requires_compliance: boolean;
    disciplines: string[];
  };
  plan: {
    type: "pipe" | "scatter_gather" | "dag" | "saga";
    steps: ExecutionStep[];
  };
  reasoning: string;
}

/**
 * DER ROUTER: Nimmt eine Aufgabe und erzeugt einen Plan.
 *
 * Das ist ein ganz normaler LLM-Call – der Router ist selbst
 * eine system.md Datei (oder hier inline definiert).
 */
async function planWorkflow(
  task: string,
  registry: Map<string, Pattern>,
  projectContext?: string
): Promise<ExecutionPlan> {
  // Router-Pattern laden (oder inline nutzen)
  const routerPattern = registry.get("_router");

  const routerSystemPrompt = routerPattern
    ? routerPattern.systemPrompt
    : getDefaultRouterPrompt(); // Fallback

  // Katalog bauen
  const catalog = buildCatalogText(registry);

  // Den User-Input für den Router zusammenbauen
  const routerInput = [
    "## AUFGABE\n",
    task,
    "\n\n## VERFÜGBARE PATTERNS\n",
    catalog,
  ];

  if (projectContext) {
    routerInput.push("\n\n## PROJEKTKONTEXT\n", projectContext);
  }

  // LLM-Call an den Router
  console.error("🧠 Router analysiert Aufgabe...");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: routerSystemPrompt,
    messages: [{ role: "user", content: routerInput.join("") }],
  });

  const responseText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  // JSON extrahieren (LLM könnte es in ```json ... ``` wrappen)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Router hat keinen gültigen Plan erzeugt:\n" + responseText);
  }

  const plan: ExecutionPlan = JSON.parse(jsonMatch[0]);

  // Validieren
  validatePlan(plan, registry);

  return plan;
}

function validatePlan(plan: ExecutionPlan, registry: Map<string, Pattern>): void {
  const stepIds = new Set(plan.plan.steps.map((s) => s.id));

  for (const step of plan.plan.steps) {
    // Pattern existiert?
    if (!registry.has(step.pattern)) {
      throw new Error(`Pattern "${step.pattern}" existiert nicht im Registry`);
    }

    // Dependencies existieren?
    for (const dep of step.depends_on) {
      if (!stepIds.has(dep)) {
        throw new Error(`Step "${step.id}" hat Dependency "${dep}" die nicht existiert`);
      }
    }

    // Keine zirkulären Dependencies? (vereinfachte Prüfung)
    if (step.depends_on.includes(step.id)) {
      throw new Error(`Step "${step.id}" hängt von sich selbst ab`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// TEIL 3: Die Engine (führt den Plan aus)
// ═══════════════════════════════════════════════════════════
//
// Nimmt den JSON-Plan und führt ihn aus.
// Kennt KEINE AI-Logik – nur mechanische Ausführung.

async function executePattern(
  patternName: string,
  input: string,
  registry: Map<string, Pattern>
): Promise<string> {
  const pattern = registry.get(patternName);
  if (!pattern) throw new Error(`Pattern "${patternName}" nicht gefunden`);

  const response = await client.messages.create({
    model: pattern.meta.preferred_provider === "ollama" 
      ? "claude-sonnet-4-20250514"  // Fallback, in echt: Ollama-Client
      : "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: pattern.systemPrompt,
    messages: [{ role: "user", content: input }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Baut den Input für einen Step zusammen:
 * - "$USER_INPUT" → der Original-Input des Users
 * - Step-IDs → die Ergebnisse dieser Steps
 */
function buildStepInput(
  step: ExecutionStep,
  userInput: string,
  results: Map<string, string>
): string {
  const parts: string[] = [];

  for (const source of step.input_from) {
    if (source === "$USER_INPUT") {
      parts.push(`## Aufgabe\n\n${userInput}`);
    } else if (results.has(source)) {
      parts.push(`## Ergebnis von "${source}"\n\n${results.get(source)}`);
    }
  }

  return parts.join("\n\n---\n\n");
}

/**
 * DIE ENGINE: Führt einen ExecutionPlan aus.
 *
 * Das ist im Kern der DAG-Runner von vorhin,
 * aber er arbeitet jetzt mit dem JSON-Plan des Routers.
 */
async function executePlan(
  plan: ExecutionPlan,
  userInput: string,
  registry: Map<string, Pattern>
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const status = new Map<string, "pending" | "running" | "done" | "failed">();
  const retries = new Map<string, number>();
  const feedback = new Map<string, string>();

  plan.plan.steps.forEach((s) => {
    status.set(s.id, "pending");
    retries.set(s.id, 0);
  });

  console.error("\n═══════════════════════════════════════════");
  console.error(" Executing: %s", plan.analysis.goal);
  console.error(" Type: %s | Steps: %d | Complexity: %s",
    plan.plan.type, plan.plan.steps.length, plan.analysis.complexity);
  console.error("═══════════════════════════════════════════\n");

  while ([...status.values()].some((s) => s !== "done" && s !== "failed")) {
    // Finde startbare Steps
    const ready = plan.plan.steps.filter((step) => {
      if (status.get(step.id) !== "pending") return false;
      return step.depends_on.every((dep) => status.get(dep) === "done");
    });

    if (ready.length === 0) {
      const hasRunning = [...status.values()].some((s) => s === "running");
      if (!hasRunning) {
        console.error("⚠️  Workflow blockiert – nicht alle Steps konnten abgeschlossen werden");
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }

    // Zeige was parallel startet
    if (ready.length > 1) {
      console.error("🔀 Parallel: %s", ready.map((s) => s.id).join(" + "));
    }

    ready.forEach((s) => status.set(s.id, "running"));

    // Alle bereiten Steps parallel ausführen
    await Promise.all(
      ready.map(async (step) => {
        const startTime = Date.now();
        try {
          // Input zusammenbauen
          let input = buildStepInput(step, userInput, results);

          // Feedback aus vorherigem Retry anhängen
          if (feedback.has(step.id)) {
            input += "\n\n## ⚠️ FEEDBACK\n" + feedback.get(step.id);
          }

          console.error("  ⏳ %s [%s] → %s", step.id, step.persona || "auto", step.pattern);

          // Pattern ausführen
          const result = await executePattern(step.pattern, input, registry);

          // Optional: Quality Gate
          if (step.quality_gate) {
            const evalResult = await executePattern(
              step.quality_gate.pattern,
              `Bewerte (1-10):\n\n${result}`,
              registry
            );
            const score = parseInt(evalResult.match(/(\d+)/)?.[1] || "0");
            if (score < step.quality_gate.min_score) {
              throw new Error(`Quality Gate: ${score}/${step.quality_gate.min_score}\n${evalResult}`);
            }
            console.error("  🎯 %s Quality Gate: %d/%d ✅",
              step.id, score, step.quality_gate.min_score);
          }

          results.set(step.id, result);
          status.set(step.id, "done");
          console.error("  ✅ %s (%dms)", step.id, Date.now() - startTime);

        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const currentRetries = retries.get(step.id) || 0;
          const maxRetries = step.retry?.max || 0;

          if (currentRetries < maxRetries) {
            // Retry
            console.error("  🔄 %s retry %d/%d", step.id, currentRetries + 1, maxRetries);
            feedback.set(step.id, errMsg);
            retries.set(step.id, currentRetries + 1);
            status.set(step.id, "pending");
          } else if (step.retry?.on_failure === "escalate" && step.retry.escalate_to) {
            // Eskalation
            const target = step.retry.escalate_to;
            console.error("  ⬆️  %s → eskaliert zu %s", step.id, target);
            feedback.set(target, `Folgeproblem in "${step.id}": ${errMsg}`);
            status.set(target, "pending");
            status.set(step.id, "pending");
          } else {
            console.error("  ❌ %s gescheitert", step.id);
            status.set(step.id, "failed");
          }
        }
      })
    );
  }

  // Zusammenfassung
  console.error("\n═══════════════════════════════════════════");
  for (const [id, s] of status) {
    console.error("  %s %s", s === "done" ? "✅" : "❌", id);
  }
  console.error("═══════════════════════════════════════════\n");

  return results;
}

// ═══════════════════════════════════════════════════════════
// TEIL 4: CLI – Alles zusammen
// ═══════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  // stdin lesen (falls gepiped)
  const stdinInput = await new Promise<string>((resolve) => {
    if (process.stdin.isTTY) { resolve(""); return; }
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
  });

  // ── Modus 1: Direkter Pattern-Aufruf (Fabric-Style) ──
  if (args[0] === "run") {
    const patternName = args[1];
    const registry = loadRegistry();
    const input = args.slice(2).join(" ") || stdinInput;
    const result = await executePattern(patternName, input, registry);
    process.stdout.write(result);
    return;
  }

  // ── Modus 2: Dynamische Orchestrierung ──
  // Alles was kein Subcommand ist, wird als Aufgabe interpretiert
  const task = args.join(" ") || stdinInput;

  if (!task) {
    printHelp();
    return;
  }

  // 1. Registry laden
  const registry = loadRegistry();
  console.error("📦 %d Patterns geladen", registry.size);

  // 2. Router: Plan erstellen
  const plan = await planWorkflow(task, registry);

  // 3. Plan anzeigen (bei hoher Komplexität: Bestätigung erfragen)
  console.error("\n📋 Geplanter Workflow:");
  console.error("   Typ: %s", plan.plan.type);
  console.error("   Schritte: %d", plan.plan.steps.length);
  console.error("   Begründung: %s\n", plan.reasoning);

  for (const step of plan.plan.steps) {
    const deps = step.depends_on.length
      ? ` (nach: ${step.depends_on.join(", ")})`
      : " (sofort)";
    const parallel = step.parallel_group
      ? ` [parallel: ${step.parallel_group}]`
      : "";
    console.error("   %s → %s%s%s", step.id, step.pattern, deps, parallel);
  }

  // Bei hoher Komplexität: Bestätigung
  if (plan.analysis.complexity === "high" && process.stdin.isTTY) {
    console.error("\n⚠️  Komplexer Workflow. Ausführen? [Y/n] ");
    // (In der echten Version: readline für User-Input)
  }

  // 4. Plan ausführen
  const results = await executePlan(plan, task, registry);

  // 5. Finales Ergebnis ausgeben (letzter Step)
  const lastStep = plan.plan.steps[plan.plan.steps.length - 1];
  const finalOutput = results.get(lastStep.id);

  if (finalOutput) {
    process.stdout.write(finalOutput);
  } else {
    console.error("⚠️  Kein finales Ergebnis verfügbar");
  }
}

function printHelp() {
  console.log(`
AIOS – AI Orchestration System

USAGE:

  Dynamisch (Router entscheidet):
    aios "Implementiere Feature X mit Security Compliance"
    aios "Fasse dieses Dokument zusammen" < document.md
    cat code.py | aios "Review diesen Code gründlich"

  Direkt (Fabric-Style, ein Pattern):
    aios run summarize < document.md
    cat code.py | aios run code_review
    echo "text" | aios run extract_requirements

  Der Unterschied:
    aios "..."          → Router plant den Workflow dynamisch
    aios run <pattern>  → Einzelnes Pattern, kein Router
  `);
}

function getDefaultRouterPrompt(): string {
  return `
# IDENTITY and PURPOSE

Du bist der AIOS Workflow Planner. Analysiere Aufgaben und erstelle
optimale Execution Plans.

# OUTPUT FORMAT

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein anderer Text!):

{
  "analysis": {
    "goal": "string",
    "complexity": "low | medium | high",
    "requires_compliance": boolean,
    "disciplines": ["string"]
  },
  "plan": {
    "type": "pipe | scatter_gather | dag | saga",
    "steps": [
      {
        "id": "string",
        "pattern": "string",
        "persona": "string | null",
        "depends_on": ["string"],
        "input_from": ["$USER_INPUT" | "step_id"],
        "parallel_group": "string | null",
        "retry": { "max": number, "on_failure": "retry_with_feedback | escalate", "escalate_to": "step_id" } | null,
        "quality_gate": { "pattern": "string", "min_score": number } | null
      }
    ]
  },
  "reasoning": "string"
}

# REGELN

- Einfache Aufgaben → ein Step, type "pipe"
- Reviews → scatter_gather mit 2-3 parallelen Reviews + Aggregation
- Feature-Entwicklung → dag mit Requirements → Design → Code/Tests parallel
- Regulierte Aufgaben → saga mit Quality Gates und Retries
- IMMER den einfachsten Plan der die Aufgabe erfüllt
- Nur Patterns verwenden die im Katalog existieren

# INPUT
  `;
}

main().catch((err) => {
  console.error("Fehler:", err.message);
  process.exit(1);
});
