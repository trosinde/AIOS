# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev -- <args>        # Run CLI via tsx (no build needed): tsx src/cli.ts <args>
npm run build                # Compile TypeScript → dist/
npm run start -- <args>      # Run compiled: node dist/cli.js <args>
npm run typecheck            # Type-check without emitting (tsc --noEmit)
npm test                     # Run all tests: vitest run
npx vitest run src/core/engine.test.ts          # Single test file
npx vitest run -t "test name pattern"           # Single test by name
```

## What is AIOS?

CLI-basiertes AI-Orchestrierungssystem. Fabric-Style Patterns + Enterprise Integration Patterns. Natürlichsprachliche Aufgaben werden dynamisch in parallele Workflows zerlegt.

## Strategische Richtung: AIOS als OS-Kernel

AIOS entwickelt sich zu einem **Betriebssystem-Kernel für AI-Agenten**. Das Kernprinzip: Mechanism, not policy.

```
┌─────────────────────────────────────────┐
│  Context A (z.B. dvoi-engineering)      │
│  Context B (z.B. embedded-devices)      │  ← Isolierte "User Spaces"
│  Context C (z.B. personal-projects)     │    mit eigenen Personas,
└──────────────────┬──────────────────────┘    Patterns, Knowledge
                   │ Kernel API (stabil)
┌──────────────────▼──────────────────────┐
│             AIOS Kernel                 │
│  Scheduling · IPC · Tool-Drivers        │  ← Mechanism only
│  Base Trait Protocol · Pattern-ABI      │    Keine Domain-Logik
└─────────────────────────────────────────┘
```

**Kernel-Verantwortung (darf NIE Domain-Wissen enthalten):**
- Pattern-Lade-Mechanismus und ABI-Validierung
- Execution Context (trace_id, context_id, started_at)
- Provider Abstraction (LLMProvider interface)
- DAG/Saga Engine (Scheduling-Primitive)
- Base Trait Protocol (was JEDE Persona implementieren muss)
- Knowledge Bus API (IPC zwischen Agenten, nicht die Inhalte)
- Tool-Driver-Abstraktion

**User Space (gehört NICHT in den Kernel):**
- Konkrete Personas (Requirements Engineer für DVOI)
- Domain-Patterns (CRA-spezifische Templates)
- Context-lokales Wissen
- Workflow-Definitionen für spezifische Projekte

**Die goldene Regel:** Wenn du überlegst ob etwas in den Kernel gehört, frage dich: "Würde ein Perl-Entwickler, ein Java-Entwickler UND ein CRA-Compliance-Beauftragter das gleichermaßen brauchen?" Nur wenn ja → Kernel. Sonst → User Space / Context.

## Architecture (3 Layers)

```
User Input → [Router/Meta-Agent] → Execution Plan (JSON) → [DAG Engine] → Output
```

- **Pattern Registry** (`core/registry.ts`): Loads `patterns/*/system.md` files. Each pattern = Markdown with YAML frontmatter (metadata in `PatternMeta`) + system prompt. New pattern = new Markdown file.
- **Router** (`core/router.ts`): An LLM call itself. Takes task + pattern catalog → returns JSON `ExecutionPlan`. Parses JSON from fenced or raw LLM output.
- **Engine** (`core/engine.ts`): Mechanical DAG execution. Topological sort, `Promise.all` for parallel steps, retry/rollback on failure. Supports both LLM patterns and tool patterns (CLI tool invocation).

### Key Data Flow

1. `cli.ts` parses commands via Commander.js → creates `PatternRegistry`, `LLMProvider`, `Router`, `Engine`
2. Router's `planWorkflow()` sends task + pattern catalog to LLM → gets back `ExecutionPlan` (defined in `types.ts`)
3. Engine's `execute()` runs steps respecting `depends_on` DAG, collecting `StepResult` per step
4. Steps reference patterns by name; input comes from `$USER_INPUT` or other step IDs via `input_from`

### Provider Abstraction

`agents/provider.ts` defines the `LLMProvider` interface with `complete()` and `chat()` methods. Two implementations: `ClaudeProvider` (Anthropic SDK) and `OllamaProvider` (REST). Factory function `createProvider()` creates the right one from config.

### Execution Plan Types

Plans have a `type` field: `pipe`, `scatter_gather`, `dag`, or `saga`. Steps can have `retry`, `quality_gate`, and `compensate` (saga rollback) configuration.

## Kernel ABI – Stabilitätsvertrag

Diese Interfaces sind **kernel-stable**. Änderungen erfordern Major-Version-Bump und Migrations-Guide. Kein Code darf diese ohne explizite Diskussion ändern.

### Pattern Frontmatter (kernel-stable Felder)

```yaml
# PFLICHT in jedem Pattern – wird vom Loader validiert
kernel_abi: 1          # Muss gesetzt sein, sonst Warning
name: string           # Eindeutig, snake_case
input_type: string     # Was rein kommt
output_type: string    # Was raus kommt

# User-Space-Felder – dürfen sich ändern, ohne Kernel zu brechen
persona: string               # Optional
domain_tags: string[]         # Optional, für Context-Routing
compliance_tags: string[]     # Optional
parallelizable_with: string[] # Optional
```

### ExecutionContext (kernel-stable Typ)

```typescript
// src/types.ts – diese Felder sind eingefroren
interface ExecutionContext {
  trace_id: string;      // UUID, vom Kernel vergeben
  context_id: string;    // Aktiver User-Space-Kontext
  started_at: number;    // Unix timestamp ms
  // Erweiterungen: nur additive, nie breaking
}
```

### LLMProvider Interface (kernel-stable)

```typescript
// src/agents/provider.ts – darf nicht verändert werden
interface LLMProvider {
  complete(system: string, user: string, ctx: ExecutionContext): Promise<LLMResponse>;
}
```

### Base Trait Protocol (kernel-stable)

Jede Persona MUSS diese Traits im Output liefern:

```markdown
## Handoff
**Next agent needs:** <was der nächste Agent wissen muss>

⚠️ LOW_CONFIDENCE: <Text wenn Konfidenz niedrig>  (optional, nur wenn nötig)

<!-- trace: <trace_id> -->  (immer, als HTML-Kommentar am Ende)
```

## Development Guidelines

- TypeScript strict mode, ESM modules (`"type": "module"` in package.json)
- All I/O async/await
- Prefer functions over classes, but use Interfaces for all data structures (`types.ts`)
- Pattern files are read at runtime, never bundled
- Logging on stderr, results on stdout (Unix convention)
- Tests colocated with source: `src/core/engine.test.ts` next to `src/core/engine.ts`

## CLI Commands

```bash
aios "Natürlichsprachliche Aufgabe"      # Router plans dynamically
aios run <pattern> [< input]             # Run single pattern (Fabric-Style)
aios plan "Aufgabe"                      # Plan only, don't execute
aios chat [--provider <name>]            # Interactive REPL with slash commands
aios patterns list                       # List all patterns
aios patterns show <name>               # Show pattern details
aios persona list                        # List all personas
aios persona validate [name]             # Validate persona against Base Trait Protocol
aios configure                           # Interaktiver Setup-Wizard
aios context init <name> [--local]       # Create new context
aios context switch <name>               # Switch active context
aios context list                        # List all contexts
aios context show                        # Show active context
aios knowledge publish --type <type>     # Publish knowledge item (stdin)
aios knowledge query [--type] [--tags]   # Query knowledge bus
aios knowledge search <query>            # Full-text search
```

## Aktueller Fokus: Kernel-OS-Evolution

### Abgeschlossen (Kernel Foundation)
- [x] Pattern Registry (Frontmatter parsen, Katalog bauen)
- [x] Provider Abstraction (Claude + Ollama)
- [x] CLI (`aios run <pattern>` + `aios "Aufgabe"`)
- [x] Router (Meta-Agent)
- [x] DAG Engine (parallele Ausführung)
- [x] Saga Engine (Retry/Rollback)
- [x] Tests (vitest, 35 Tests)

### Phase 0 – Kernel ABI Spec ✅
- [x] `docs/KERNEL_ABI.md` – Kernel-stable Interfaces und Stabilitätsvertrag
- [x] `docs/PERSONA_TRAITS.md` – Base Trait Protocol
- [x] `docs/CONTEXT_MODEL.md` – Context-Isolation-Modell
- [x] `docs/IPC_PROTOCOL.md` – Agent-zu-Agent-Kommunikation

### Phase 1 – Kernel-Primitives ✅
- [x] `kernel_abi: 1` zu allen 36 Patterns hinzugefügt
- [x] `ExecutionContext`-Typ in `src/types.ts` (trace_id, context_id, started_at)
- [x] `LLMProvider.complete()` + `chat()` mit `ExecutionContext`-Parameter
- [x] Loader-Warning wenn Pattern `kernel_abi` fehlt, Error wenn inkompatibel
- [x] ExecutionContext durch Engine, Router, alle 4 Provider implementiert

### Phase 2 – Trait-System ✅
- [x] `personas/kernel/base_traits.yaml` – Kernel-Trait-Definitionen (handoff, confidence, trace)
- [x] `src/core/trait-validator.ts` – Validator + Output-Patching (graceful degradation)
- [x] `aios persona validate [name]` CLI-Befehl
- [x] `aios persona list` CLI-Befehl

### Phase 3 – Knowledge Bus ✅
- [x] `KnowledgeBus` mit `KernelMessage`-Format (kernel-stable)
- [x] SQLite-Backend mit `context_id` als Isolation-Grenze
- [x] Cross-Context IPC (Broadcast + gezielte Nachrichten)
- [x] `aios knowledge publish/query/search` CLI-Befehle

### Phase 4 – Context-Isolation-Modell ✅
- [x] `context.yaml` Format mit ContextConfig
- [x] `~/.aios/kernel/` für globale Kernel-Ressourcen
- [x] `.aios/` in Projekt-Verzeichnis für Context-lokale Ressourcen
- [x] `aios context init/switch/list/show` CLI-Befehle
- [x] Pattern-Lookup-Reihenfolge (4 Ebenen)

### Setup & Configure
- [x] `install.sh` — Curl-barer Installer (Bash)
- [x] `aios configure` — Interaktiver Setup-Wizard
- [x] `.env` Management (loadEnv, saveEnv)
- [x] `saveConfig()` für Config-Persistierung

### Noch offen (nach Phase 4)
- Phase 5: Migration bestehender Agents + Tool-Driver-Registry + Compliance-Layer
- Phase 6: Context-Packaging und Distribution (`aios context package/install`)
- Phase 7: Stable Kernel ABI v1.0 Freeze

---

## Wichtige Konzeptdocs

## Documentation

Detailed docs in `docs/`: VISION.md, ARCHITECTURE.md, PATTERNS.md, WORKFLOWS.md, PERSONAS.md, PHASES.md, REGULATED.md. Reference implementations in `docs/reference/`.

Kernel-OS-Evolution:
- `docs/KERNEL_ABI.md` – Kernel-stable Interfaces und Stabilitätsvertrag (TODO Phase 0)
- `docs/PERSONA_TRAITS.md` – Base Trait Protocol für alle Personas (TODO Phase 0)
- `docs/CONTEXT_MODEL.md` – Context-Isolation-Modell und Verzeichnisstruktur (TODO Phase 0)
- `docs/IPC_PROTOCOL.md` – Agent-zu-Agent-Kommunikations-Protokoll (TODO Phase 0)
