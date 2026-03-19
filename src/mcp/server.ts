/**
 * AIOS MCP Server – exponiert AIOS-Patterns als MCP-Tools über stdio.
 *
 * Tools:
 *   aios_run          – Einzelnes Pattern ausführen
 *   aios_orchestrate  – Dynamische Orchestrierung (Router → DAG Engine)
 *   aios_patterns     – Pattern-Katalog abfragen
 *   aios_plan         – Nur Workflow planen
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PatternRegistry } from "../core/registry.js";
import { PersonaRegistry } from "../core/personas.js";
import { Router } from "../core/router.js";
import { Engine } from "../core/engine.js";
import { createProvider } from "../agents/provider.js";
import { ProviderSelector } from "../agents/provider-selector.js";
import { loadConfig } from "../utils/config.js";
import type { AiosConfig } from "../types.js";
import type { LLMProvider } from "../agents/provider.js";

/** Suppress all stderr output in MCP mode (would corrupt JSON-RPC protocol) */
function silenceStderr(): void {
  // Replace console.error with no-op
  console.error = () => {};
  console.warn = () => {};

  // Redirect stderr writes to /dev/null
  const devnull = { write: () => true, end: () => {} } as unknown as NodeJS.WriteStream;
  Object.defineProperty(process, "stderr", { value: devnull, writable: true });
}

/** Build all providers and a ProviderSelector from config */
function buildProviderSelector(config: AiosConfig): ProviderSelector {
  const allProviders = new Map<string, LLMProvider>();
  for (const [name, cfg] of Object.entries(config.providers)) {
    try { allProviders.set(name, createProvider(cfg)); } catch { /* skip */ }
  }
  return new ProviderSelector(allProviders, config.providers);
}

/** Build compact pattern catalog for MCP tool response */
function buildPatternList(registry: PatternRegistry): string {
  const lines: string[] = [];
  for (const p of registry.all()) {
    if (p.meta.internal) continue;
    const type = p.meta.type === "mcp" ? " [MCP]" : p.meta.type === "tool" ? " [TOOL]" : "";
    lines.push(`- ${p.meta.name}${type}: ${p.meta.description} (${p.meta.input_type} → ${p.meta.output_type})`);
  }
  return lines.join("\n");
}

export async function startMCPServer(): Promise<void> {
  silenceStderr();

  // Set env flag so downstream code knows we're in MCP mode
  process.env.AIOS_MCP_MODE = "1";

  const config = loadConfig();
  const registry = new PatternRegistry(config.paths.patterns);
  const providerName = config.defaults.provider;
  const providerCfg = config.providers[providerName];
  if (!providerCfg) {
    throw new Error(`Default provider "${providerName}" not configured`);
  }
  const provider = createProvider(providerCfg);
  const personas = new PersonaRegistry(config.paths.personas);
  const selector = buildProviderSelector(config);

  const server = new Server(
    { name: "aios", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // ─── tools/list ──────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "aios_run",
          description:
            "Führt ein AIOS-Pattern direkt aus (Fabric-Style). Gibt das Ergebnis als Text zurück. Patterns sind wiederverwendbare AI-Workflows für Code Review, Security Review, Zusammenfassungen, Requirements-Extraktion und mehr.",
          inputSchema: {
            type: "object" as const,
            properties: {
              pattern: {
                type: "string",
                description:
                  "Name des Patterns (z.B. 'summarize', 'code_review', 'security_review'). Nutze aios_patterns um alle verfügbaren Patterns zu sehen.",
              },
              input: {
                type: "string",
                description: "Der Input-Text der vom Pattern verarbeitet wird",
              },
              provider: {
                type: "string",
                description: "Optional: LLM-Provider Override (z.B. 'ollama-fast')",
              },
            },
            required: ["pattern", "input"],
          },
        },
        {
          name: "aios_orchestrate",
          description:
            "Analysiert eine Aufgabe und führt automatisch den optimalen Workflow aus (Router → DAG Engine). Nutzt parallele Pattern-Ausführung, Retry und Quality Gates. Ideal für komplexe Aufgaben die mehrere Patterns kombinieren.",
          inputSchema: {
            type: "object" as const,
            properties: {
              task: {
                type: "string",
                description: "Natürlichsprachliche Aufgabe (z.B. 'Analysiere diesen Code auf Security-Probleme und erstelle einen Report')",
              },
              dry_run: {
                type: "boolean",
                description: "Nur planen, nicht ausführen. Gibt den Execution Plan als JSON zurück.",
              },
            },
            required: ["task"],
          },
        },
        {
          name: "aios_patterns",
          description:
            "Listet alle verfügbaren AIOS-Patterns mit Beschreibung und Input/Output-Typen. Nutze dies um zu sehen welche Patterns für aios_run verfügbar sind.",
          inputSchema: {
            type: "object" as const,
            properties: {},
          },
        },
        {
          name: "aios_plan",
          description:
            "Plant einen Workflow für eine Aufgabe ohne ihn auszuführen. Zeigt welche Patterns in welcher Reihenfolge und Parallelität ausgeführt würden. Nützlich um den Orchestrierungs-Plan zu inspizieren bevor er ausgeführt wird.",
          inputSchema: {
            type: "object" as const,
            properties: {
              task: {
                type: "string",
                description: "Natürlichsprachliche Aufgabe",
              },
            },
            required: ["task"],
          },
        },
      ],
    };
  });

  // ─── tools/call ──────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "aios_run": {
          const patternName = args?.pattern as string;
          const input = args?.input as string;
          const providerOverride = args?.provider as string | undefined;

          const pattern = registry.get(patternName);
          if (!pattern) {
            return {
              content: [{ type: "text" as const, text: `Fehler: Pattern "${patternName}" nicht gefunden. Nutze aios_patterns um verfügbare Patterns zu sehen.` }],
              isError: true,
            };
          }

          // Resolve provider (override or pattern-preferred or default)
          let runProvider = provider;
          if (providerOverride) {
            const cfg = config.providers[providerOverride];
            if (cfg) runProvider = createProvider(cfg);
          } else if (pattern.meta.preferred_provider) {
            const cfg = config.providers[pattern.meta.preferred_provider];
            if (cfg) runProvider = createProvider(cfg);
          }

          // Build prompt with optional persona
          const personaId = pattern.meta.persona;
          const persona = personaId ? personas.get(personaId) : undefined;
          const fullPrompt = persona
            ? `${persona.system_prompt}\n\n---\n\n${pattern.systemPrompt}`
            : pattern.systemPrompt;

          const result = await runProvider.complete(fullPrompt, input);
          return {
            content: [{ type: "text" as const, text: result.content }],
          };
        }

        case "aios_orchestrate": {
          const task = args?.task as string;
          const dryRun = args?.dry_run as boolean | undefined;

          const router = new Router(registry, provider);
          const engine = new Engine(registry, provider, config, personas, undefined, undefined, selector);
          const plan = await router.planWorkflow(task);

          if (dryRun) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
            };
          }

          const result = await engine.execute(plan, task);
          // Combine all step results
          const output = Array.from(result.results.entries())
            .map(([id, r]) => `## ${id}\n${r.output}`)
            .join("\n\n");
          return {
            content: [{ type: "text" as const, text: output }],
          };
        }

        case "aios_patterns": {
          const catalog = buildPatternList(registry);
          return {
            content: [{ type: "text" as const, text: catalog }],
          };
        }

        case "aios_plan": {
          const task = args?.task as string;
          const router = new Router(registry, provider);
          const plan = await router.planWorkflow(task);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
          };
        }

        default:
          return {
            content: [{ type: "text" as const, text: `Unbekanntes Tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `AIOS Fehler: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  // ─── Start ───────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
