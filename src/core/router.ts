import type { LLMProvider } from "../agents/provider.js";
import type { PatternRegistry } from "./registry.js";
import type { ExecutionContext, ExecutionPlan } from "../types.js";
import { PromptBuilder } from "../security/prompt-builder.js";

/**
 * Router – der Meta-Agent.
 * Bekommt Aufgabe + Pattern-Katalog → gibt JSON Execution Plan zurück.
 */
export class Router {
  private promptBuilder = new PromptBuilder();

  constructor(
    private registry: PatternRegistry,
    private provider: LLMProvider
  ) {}

  async planWorkflow(task: string, projectContext?: string, ctx?: ExecutionContext): Promise<ExecutionPlan> {
    // Router-Pattern laden (falls vorhanden), sonst Default-Prompt
    const routerPattern = this.registry.get("_router");
    const systemPrompt = routerPattern?.systemPrompt ?? DEFAULT_ROUTER_PROMPT;

    // User-Input: Aufgabe + Katalog + optionaler Kontext
    const catalog = this.registry.buildCatalog();
    const parts = [`## AUFGABE\n\n${task}`, `## VERFÜGBARE PATTERNS\n\n${catalog}`];
    if (projectContext) parts.push(`## PROJEKTKONTEXT\n\n${projectContext}`);

    const userInput = parts.join("\n\n");
    const built = this.promptBuilder.build(systemPrompt, userInput, [], ctx?.trace_id);
    const response = await this.provider.complete(built.systemPrompt, built.userMessage, undefined, ctx);
    let plan = this.extractPlan(response.content);

    // Validate: retry once if LLM hallucinated patterns
    const invalidPatterns = this.findInvalidPatterns(plan);
    if (invalidPatterns.length > 0) {
      const unique = [...new Set(invalidPatterns)];
      const correction = `\n\n## KORREKTUR\n\nDein vorheriger Plan enthielt ungültige Patterns: ${unique.join(", ")}\nDiese existieren NICHT im Katalog. Bitte erstelle einen neuen Plan NUR mit Patterns aus dem Katalog.`;
      const retryBuilt = this.promptBuilder.build(systemPrompt, userInput + correction, [], ctx?.trace_id);
      const retryResponse = await this.provider.complete(retryBuilt.systemPrompt, retryBuilt.userMessage, undefined, ctx);
      plan = this.extractPlan(retryResponse.content);

      const stillInvalid = this.findInvalidPatterns(plan);
      if (stillInvalid.length > 0) {
        plan = this.filterInvalidSteps(plan);
        if (plan.plan.steps.length === 0) {
          throw new Error("Router konnte keinen gültigen Plan erstellen – alle Patterns ungültig");
        }
      }
    }

    this.validateDependencies(plan);
    return plan;
  }

  private extractPlan(content: string): ExecutionPlan {
    let jsonStr: string;
    const fencedMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fencedMatch) {
      jsonStr = fencedMatch[1];
    } else {
      const rawMatch = content.match(/\{[\s\S]*\}/);
      if (!rawMatch) {
        throw new Error("Router hat keinen gültigen Plan erzeugt:\n" + content);
      }
      jsonStr = rawMatch[0];
    }

    try {
      return JSON.parse(jsonStr);
    } catch {
      throw new Error("Router hat ungültiges JSON erzeugt:\n" + jsonStr.slice(0, 200));
    }
  }

  private findInvalidPatterns(plan: ExecutionPlan): string[] {
    return plan.plan.steps
      .map(s => s.pattern)
      .filter(p => !this.registry.get(p));
  }

  private filterInvalidSteps(plan: ExecutionPlan): ExecutionPlan {
    const removedIds = new Set<string>();
    for (const step of plan.plan.steps) {
      if (!this.registry.get(step.pattern)) {
        console.error(`⚠️  Pattern "${step.pattern}" existiert nicht – Step "${step.id}" wird übersprungen`);
        removedIds.add(step.id);
      }
    }

    const steps = plan.plan.steps
      .filter(step => !removedIds.has(step.id))
      .map(step => {
        const depends_on = step.depends_on.filter(dep => !removedIds.has(dep));
        const input_from = step.input_from.filter(ref => !removedIds.has(ref));
        return { ...step, depends_on, input_from: input_from.length > 0 ? input_from : ["$USER_INPUT"] };
      });

    return { ...plan, plan: { ...plan.plan, steps } };
  }

  private validateDependencies(plan: ExecutionPlan): void {
    const ids = new Set(plan.plan.steps.map((s) => s.id));
    for (const step of plan.plan.steps) {
      for (const dep of step.depends_on) {
        if (!ids.has(dep)) throw new Error(`Dependency "${dep}" in Step "${step.id}" existiert nicht`);
      }
    }
  }
}

const DEFAULT_ROUTER_PROMPT = `
# IDENTITY and PURPOSE

Du bist der AIOS Workflow Planner. Analysiere die Aufgabe und erstelle
einen optimalen Execution Plan basierend auf den verfügbaren Patterns.

# OUTPUT FORMAT

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:

{
  "analysis": {
    "goal": "string",
    "complexity": "low | medium | high",
    "requires_compliance": false,
    "disciplines": ["string"]
  },
  "plan": {
    "type": "pipe | scatter_gather | dag | saga",
    "steps": [
      {
        "id": "string",
        "pattern": "pattern_name_from_catalog",
        "persona": "string | null",
        "depends_on": [],
        "input_from": ["$USER_INPUT"],
        "parallel_group": null,
        "retry": null,
        "quality_gate": null
      }
    ]
  },
  "reasoning": "Kurze Begründung"
}

# REGELN

- Einfache Aufgabe → ein Step, type "pipe"
- Reviews → scatter_gather (2-3 parallel + Aggregation)
- Feature-Entwicklung → dag (Requirements → Design → parallel Code/Tests)
- Regulierte Aufgaben → saga (mit Quality Gates und Retry)
- NUR Patterns verwenden die im Katalog stehen
- Keine zirkulären Dependencies
- Minimaler Plan der die Aufgabe erfüllt

# TOOL-PATTERNS

Im Katalog gibt es zwei Typen von Patterns:
- **LLM**: Werden von einem LLM ausgeführt (Standard)
- **TOOL**: Führen ein CLI-Tool aus (kein LLM). Markiert mit "Typ: TOOL"

Wenn ein TOOL-Pattern als "NICHT VERFÜGBAR" markiert ist, verwende es NICHT im Plan.

Tool-Patterns können in Workflows eingebunden werden wie LLM-Patterns.
Typisches Beispiel: LLM erzeugt Mermaid-Code → Tool rendert zu SVG.

# MCP-PATTERNS

Im Katalog gibt es auch MCP-Patterns (Markiert mit "Typ: MCP").
Diese rufen externe Dienste auf (z.B. Azure DevOps, GitHub).

WICHTIG für MCP-Patterns:
- MCP-Tools erwarten strukturierte JSON-Argumente als Input
- Wenn ein MCP-Step Input von einem LLM-Step bekommt, muss der LLM-Step
  JSON erzeugen das zum Parameter-Schema des MCP-Tools passt
- Die Parameter-Beschreibung im Katalog zeigt welche Felder erwartet werden (* = required)
- Beispiel-Workflow: LLM analysiert Aufgabe → erzeugt JSON → MCP-Tool führt aus
`;
