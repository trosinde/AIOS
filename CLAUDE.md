# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ARCHITEKTUR-SCHULD

Drei inkompatible context.yaml Formate (AiosContext, ContextManifest, ContextConfig) existieren. `aios init` ist der einzige Init-Befehl. `federation-init` und `context init` sind redundant und werden entfernt. EIN Format, EIN Schema. Jedes neue Feature das context.yaml betrifft MUSS das vereinheitlichte Format verwenden. Review-Prozess muss Format-Kompatibilität explizit prüfen.

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
- Service Interfaces (data/manifest.yaml, Template-Daten, Query-Engine)

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

### Service Interfaces (User Space)

Kontexte können strukturierte Daten als abfragbare Services bereitstellen. Komplett im User Space – kein Kernel-Code betroffen.

```
teams/hr/
├── .aios/context.yaml                 ← Kontext-Definition
├── data/
│   ├── manifest.yaml                  ← Deklariert welche Dateien Services sind
│   ├── employees.json                 ← Strukturierte Daten (Array von Objekten)
│   └── departments.yaml              ← Weitere Datenquellen
└── .aios/services.generated.yaml      ← Auto-generierter Cache
```

**Ablauf:**
1. `aios service init teams/hr` → Liest `context.yaml` exports, generiert Template-Daten + `data/manifest.yaml`
2. `aios service list` → Inferiert Schema aus Dateien, zeigt alle Endpoints
3. `aios service call hr.employees '{"name": "Max"}'` → Hybrid-Suche: direkt in JSON, bei Bedarf LLM-Fallback

**Module** (alle in `src/service/`, User Space):
- `manifest-parser.ts` – Liest und validiert `data/manifest.yaml`
- `schema-inferrer.ts` – Erkennt Felder/Typen aus JSON/YAML automatisch
- `service-generator.ts` – Generiert ServiceEndpoints mit mtime-basiertem Cache
- `query-engine.ts` – Hybrid: direkte Suche + LLM-Fallback (via PromptBuilder)
- `service-bus.ts` – Orchestrierung, Discovery, SQLite Request-Tracking
- `service-init.ts` – Bootstrap für bestehende Kontexte (domänenspezifische Templates)

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

## Pflicht-Review-Prozess (vor jedem Commit)

Jede Implementierung MUSS vor dem Commit diese drei Reviews durchlaufen. Führe sie parallel als Subagenten aus:

### 1. Design/Konzept-Review
- Kernel/User-Space-Trennung (goldene Regel anwenden)
- Architektur-Konsistenz mit bestehenden Modulen
- Schnittstellenverträglichkeit (keine Doppelungen, keine Schema-Konflikte)
- Prüfung ob neue Interfaces kernel-stable sein sollten

### 2. Code Review
- TypeScript Strict Mode Compliance (keine unsafe Casts, keine `!` ohne Grund)
- Security: Path Traversal, Injection, Trust Boundaries, OWASP Top 10
- Error Handling: Alle Fehlerpfade behandelt, keine unvalidierten LLM-Outputs
- ExecutionContext wird an alle Provider-Calls durchgereicht
- ESM Module Compliance (.js Extensions)
- CLAUDE.md Konventionen (stderr/stdout, async/await)
- Severity-Level pro Finding: CRITICAL > HIGH > MEDIUM > LOW

### 3. Test-Coverage-Analyse
- Alle neuen Funktionen haben Tests
- Edge Cases: null/undefined, leere Arrays, korrupte Dateien
- Error Paths: Fehlerbehandlung getestet
- Integration: Zusammenspiel zwischen Modulen
- Keine Datei mit 0% Coverage bei neuem Code

### Ablauf
```
1. Implementierung abschließen
2. Drei Reviews parallel laufen (Design, Code, Tests)
3. CRITICAL und HIGH Findings fixen
4. Tests + Typecheck erneut laufen lassen
5. Erst dann committen
```

## Security Guidelines

- Every LLM call MUST use the PromptBuilder for Data/Instruction Separation
- User input is NEVER directly concatenated into system prompts
- All data flows carry Taint Labels (`TaintLabel` interface from `src/security/`)
- Tool patterns validate all arguments before CLI execution (no shell injection)
- Knowledge Base writes go through the KnowledgeGuard
- Security-relevant decisions are logged via the AuditLogger
- New patterns should declare `trust_boundary` in YAML frontmatter
- See `docs/SECURITY.md` for the full Threat Model and Defense-in-Depth architecture

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
aios update                              # Update AIOS auf neueste Version
aios update --check                      # Nur prüfen ob Updates verfügbar
aios configure                           # Interaktiver Setup-Wizard
aios context init <name> [--local]       # Create new context
aios context switch <name>               # Switch active context
aios context rename <new-name>           # Rename active context
aios context list                        # List all contexts
aios context show                        # Show active context
aios knowledge publish --type <type>     # Publish knowledge item (stdin)
aios knowledge query [--type] [--tags]   # Query knowledge bus
aios knowledge search <query>            # Full-text search
aios knowledge migrate                   # Legacy SQLite → LanceDB migration
aios service init [path]                 # Bootstrap service interface für Kontext
aios service list                        # Alle Service-Endpoints auflisten
aios service show <ctx>.<endpoint>       # Endpoint-Details + Schema anzeigen
aios service call <ctx>.<ep> <json>      # Service-Endpoint abfragen
aios service refresh [context]           # Service-Cache neu generieren
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
- [x] `kernel_abi: 1` zu allen 37 Patterns hinzugefügt
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

### Phase 4b – Service Interfaces (Cross-Context Data Sharing) ✅
- [x] `data/manifest.yaml` als Deklaration welche Dateien als Service verfügbar sind
- [x] Schema-Inferenz aus JSON/YAML-Datendateien (`src/service/schema-inferrer.ts`)
- [x] Service-Generator mit Cache-Invalidierung (`src/service/service-generator.ts`)
- [x] Hybrid Query-Engine: direkte Suche + LLM-Fallback (`src/service/query-engine.ts`)
- [x] ServiceBus: Discovery, Call, Request-Tracking in SQLite (`src/service/service-bus.ts`)
- [x] `aios service init` Bootstrap für bestehende Kontexte (`src/service/service-init.ts`)
- [x] `aios service list/show/call/refresh` CLI-Befehle
- [x] PromptBuilder-Integration für sichere LLM-Calls
- [x] Beispiel-Kontexte: HR (Mitarbeiter, Abteilungen), Securitas (Findings), Network (Topologie)

### Phase 4c – KnowledgeBus auf LanceDB (Persistentes Gedächtnis) ✅
- [x] **Persistenter HNSW-Vektor-Store** via LanceDB (`@lancedb/lancedb@0.27.2`), Rust-Core, Node-native, embedded — kein externer Subprocess, keine zusätzliche Sprach-Runtime
- [x] `src/core/knowledge-bus.ts`: async API (`publish`/`query`/`search`/`byTrace`/`stats`/`delete`) + additive Methoden `semanticSearch`, `checkDuplicate`, `publishMany`, `listTaxonomy`, `kgAdd`/`kgQuery`, `diaryWrite`/`diaryRead`
- [x] `src/core/embedding-provider.ts`: `EmbeddingProvider` Interface, `OllamaEmbeddingProvider` (Default `nomic-embed-text`, 768 dim), `StubEmbeddingProvider` für Tests
- [x] `src/core/wing-resolver.ts`: Wing/Room-Hierarchie und Category→Wing-Mapping; liest `ContextConfig.memory.wings` mit 6-Level-Parent-Walk
- [x] `src/core/knowledge-bus-schema.ts`: zentrales Arrow-Schema für `messages` und `kg_triples` Tabellen
- [x] `src/core/kcn.ts`: **Knowledge Compact Notation** — token-effizientes Wire-Format für recall-Output (~60% billiger als JSON)
- [x] **Engine kb-Pattern-Type:** `executeKb` Executor in `src/core/engine.ts`, dispatched `kb_operation: "recall" | "store"` — kombiniert LLM-Extraktion (Pattern-System-Prompt) und KB-Calls in einem Step
- [x] Patterns `memory_recall` und `memory_store` als `type: kb` (kein Tool-Script-Umweg)
- [x] **Quality-Pipeline async**: `quality/pipeline.ts:consistency_check` nutzt `await knowledgeBus.query` parallel
- [x] CLI: `aios knowledge publish/query/search/semantic-search/taxonomy/diary/diary-write/kg-add/kg-query` (alle async)
- [x] Tests: 29 KnowledgeBus-Tests, 14 Wing-Resolver-Tests, 12 KCN-Tests
- [x] Performance: 10 Vitest-Benchmarks (`src/core/knowledge-bus.bench.ts`) mit Failure-Thresholds, Scale-Tests (100k Items) in `scripts/perf/knowledge-bus-scale.ts`, 8-Szenarien-Suite in `scripts/perf/kb-perf-scenarios.ts` (recall@k, search_filter, concurrent, RSS-Sampling, sequential vs batched, leak detection), Baseline-Vergleich via `scripts/perf/compare-baseline.ts`
- [x] `docs/KNOWLEDGE_BUS.md` als zentrale Doku

### Phase 5 – Agent Migration, Tool-Driver-Registry, Compliance-Layer ✅
- [x] **5.1 Persona Trait Migration**: alle 15 Personas um Base Trait Protocol ergänzt (`scripts/migrate-persona-traits.ts`), CI-Gate-Test `src/core/personas.traits.test.ts`
- [x] **5.2 Tool Driver Registry (POC)**: `DriverDefinition` ABI-Types in `src/types.ts`, `src/core/driver-registry.ts` (4-Ebenen-Lookup, kernel_abi-Hard-Fail, Lazy-Version-Check, argv-Schema-Validierung, Shell-Metachar-Block, Path-Traversal-Guard), erster Driver `drivers/mermaid/driver.yaml`, Engine-Dispatch `executeDriverOperation`, `render_diagram` migriert, Legacy-Deprecation-Warning
- [x] **5.3 Compliance & Sandbox Layer**: `PolicyEngine` an Engine angehängt (Taint-Propagation `userInputTaint→derivedTaint` pro Step, Audit-Trail), `compliance_tags` + `trust_boundary` in PatternMeta (Pattern↔Context Tag-Matching), `checkDriverCapabilities` (Default-Deny `network`/`spawn`), Sandbox-Pfad-Root-Enforcement + `max_output_mb`-Cap, CLI default-allow (strict opt-in Phase 5.4)

### Phase 5.4 – Strict Policies Opt-in + Internal Pattern Type ✅
- [x] `security.integrity_policies: "strict" | "relaxed"` in ContextConfig — Context-Level Flag für DEFAULT_POLICIES
- [x] `buildSecurityLayer()` in CLI liest aktiven Context und baut PolicyEngine kontextabhängig auf
- [x] `contextConfig` an Engine durchgereicht für context_id + compliance_tags in ExecutionContext
- [x] Neuer Pattern-Typ `type: "internal"` + `internal_op` — Kernel dispatcht zu internen TypeScript-Funktionen statt Subprozess
- [x] `src/core/pdf-operations.ts`: 4 PDF-Operationen (merge, split, extract-text, img-to-pdf) als interne Module
- [x] Sandbox-Root-Enforcement via `setAllowedRoots()` für interne Operationen
- [x] 4 Patterns migriert (pdf_merge, pdf_split, pdf_extract_text, pdf_convert) von `type: tool`/`tool: tsx` zu `type: internal`
- [x] `aios run` Direct-Run-Pfad konsolidiert: alle nicht-LLM-Typen nutzen vollständige Engine mit PolicyEngine + DriverRegistry
- [x] Tests: 9 PDF-Ops-Tests, 7 Strict-Policy-Tests, 3 Engine-Internal-Tests (834 gesamt)

### Noch offen (nach Phase 5)
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

Security:
- `docs/SECURITY.md` – Threat Model, Defense-in-Depth, Taint Tracking
- `docs/THREAT_MODEL.md` – STRIDE-Analyse aller Komponenten
