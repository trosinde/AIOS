# 08 – Technische Umsetzung

## Zielarchitektur

AIOS wird als Node.js/TypeScript-basiertes CLI-Tool implementiert (ESM Modules, strict mode).

## Tech Stack

| Komponente | Technologie | Begründung |
|-----------|-------------|------------|
| Runtime | Node.js 20+ / TypeScript | ESM, strict mode, native fetch |
| CLI Framework | `commander.js` + `chalk` | Etabliert, gut testbar |
| LLM Provider | Anthropic SDK + Ollama REST | Claude für Reasoning, Ollama für Speed |
| Config | YAML (`yaml`) | Menschenlesbar, einfach editierbar |
| Pattern-Parsing | `gray-matter` | Frontmatter aus Markdown extrahieren |
| DB | `better-sqlite3` | Knowledge Base (geplant, Phase 3) |
| Tests | `vitest` | Schnell, TypeScript-native |

## Projektstruktur

```
aios/
├── package.json
├── tsconfig.json
├── aios.yaml              # Projekt-lokale Config
├── README.md
├── CLAUDE.md              # Instruktionen für Claude Code
├── src/
│   ├── cli.ts             # Entry Point (Commander.js)
│   ├── types.ts           # Alle Interfaces
│   ├── core/
│   │   ├── registry.ts    # Pattern Registry (Frontmatter + Katalog)
│   │   ├── router.ts      # Meta-Agent (LLM → JSON Execution Plan)
│   │   └── engine.ts      # DAG/Saga Execution Engine
│   ├── agents/
│   │   └── provider.ts    # LLM Provider Abstraction (Claude, Ollama)
│   └── utils/
│       ├── config.ts      # YAML Config Management (lokal → global → default)
│       └── stdin.ts       # stdin Helper
├── patterns/              # Pattern Library (Markdown + YAML Frontmatter)
│   ├── _router/           # Internes Router-Pattern
│   ├── summarize/
│   ├── code_review/
│   └── ...
├── personas/              # Persona-Definitionen (geplant, Phase 3)
└── tests/                 # Vitest Tests
```

## Implementation: Kernkomponenten

### Provider Abstraction

```typescript
// src/agents/provider.ts
export interface LLMProvider {
  complete(system: string, user: string): Promise<LLMResponse>;
}

class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  async complete(system: string, user: string): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    // Text-Blöcke extrahieren, Token-Usage zurückgeben
    return { content, model, tokensUsed: { input, output } };
  }
}

class OllamaProvider implements LLMProvider {
  async complete(system: string, user: string): Promise<LLMResponse> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: "POST",
      body: JSON.stringify({ model, messages, stream: false }),
    });
    // Response parsen, Token-Counts extrahieren
    return { content, model, tokensUsed: { input, output } };
  }
}

// Factory
export function createProvider(config: ProviderConfig): LLMProvider;
```

### Pattern Registry

```typescript
// src/core/registry.ts
export class PatternRegistry {
  constructor(patternsDir: string); // Lädt alle patterns/*/system.md
  get(name: string): Pattern | undefined;
  list(): string[];
  all(): Pattern[];
  buildCatalog(): string; // Kompakter Text-Katalog für Router
}
```

### Router (Meta-Agent)

```typescript
// src/core/router.ts
export class Router {
  constructor(registry: PatternRegistry, provider: LLMProvider);
  planWorkflow(task: string, projectContext?: string): Promise<ExecutionPlan>;
  // Intern: JSON aus LLM-Antwort extrahieren, Plan validieren
}
```

### Engine (DAG/Saga Execution)

```typescript
// src/core/engine.ts
export class Engine {
  constructor(registry: PatternRegistry, provider: LLMProvider);
  execute(plan: ExecutionPlan, userInput: string): Promise<WorkflowResult>;
  // Topologische Sortierung, Promise.all für Paralleles, Retry bei Fehler
}
```

## Nutzung

### Setup

```bash
# Repository klonen
git clone https://github.com/trosinde/AIOS.git && cd AIOS
npm install

# API Key setzen
export ANTHROPIC_API_KEY=your-key
```

### CLI Befehle

```bash
# Fabric-Style: Ein Pattern direkt
echo "Langer Text..." | npx tsx src/cli.ts run summarize

# Dynamisch: Router plant den Workflow
npx tsx src/cli.ts "Review diesen Code auf Security und Qualität"

# Nur Plan anzeigen
npx tsx src/cli.ts plan "Implementiere OAuth2 mit IEC 62443 Compliance"

# Patterns auflisten
npx tsx src/cli.ts patterns list

# Pattern-Details anzeigen
npx tsx src/cli.ts patterns show code_review
```

## Konfiguration

```yaml
# aios.yaml
providers:
  claude:
    type: anthropic
    model: claude-sonnet-4-20250514
  ollama-fast:
    type: ollama
    model: qwen3:235b
    endpoint: http://localhost:11434

defaults:
  provider: claude

paths:
  patterns: ./patterns
  personas: ./personas
```

Config-Hierarchie: `./aios.yaml` → `~/.aios/config.yaml` → Default

## MCP Server Integration (geplant)

AIOS kann als MCP Server exponiert werden, sodass Claude Code direkt darauf zugreifen kann:

```json
// .mcp.json (in Claude Code Projekt)
{
  "mcpServers": {
    "aios": {
      "command": "npx",
      "args": ["tsx", "src/cli.ts", "mcp-server"],
      "env": {
        "AIOS_HOME": "~/.aios"
      }
    }
  }
}
```
