# AIOS – AI Orchestration System

## Was ist das?

CLI-basiertes AI-Orchestrierungssystem. Fabric-Style Patterns + Enterprise Integration Patterns. Natürlichsprachliche Aufgaben werden dynamisch in parallele Workflows zerlegt.

## Architektur (3 Schichten)

```
User Input → [Router/Meta-Agent] → Execution Plan (JSON) → [DAG Engine] → Output
```

- **Pattern Registry:** Markdown-Dateien (`patterns/*/system.md`) mit YAML-Frontmatter (Metadaten) + Prompt. Neue Patterns = neue Markdown-Datei.
- **Router:** Selbst ein LLM-Call. Aufgabe + Pattern-Katalog → JSON Execution Plan.
- **Engine:** Mechanische DAG-Ausführung. `Promise.all` für Paralleles, Retry/Rollback bei Fehler.

## Tech Stack

- Runtime: Node.js 20+ / TypeScript (ESM)
- CLI: Commander.js + chalk
- LLM: Anthropic SDK + Ollama REST
- Config: YAML (yaml) / Pattern-Parsing: gray-matter
- DB: better-sqlite3 (Knowledge Base)

## Projektstruktur

```
src/
├── cli.ts              # Entry Point
├── types.ts            # Alle Interfaces
├── core/
│   ├── registry.ts     # Pattern Registry (lädt system.md, extrahiert Frontmatter)
│   ├── router.ts       # Meta-Agent (plant Workflows via LLM)
│   └── engine.ts       # DAG/Saga Execution Engine
├── agents/
│   └── provider.ts     # LLM Provider Abstraction (Claude, Ollama)
└── utils/
    ├── config.ts       # YAML Config Management
    └── stdin.ts        # stdin Helper
patterns/*/system.md    # Pattern Library
personas/*.yaml         # Persona-Definitionen
docs/                   # Konzeptdokumentation
```

## Entwicklungsrichtlinien

- TypeScript strict mode, ESM modules
- Alle I/O async/await
- Keine Klassen wo Funktionen reichen, aber Interfaces für alle Datenstrukturen
- Tests mit vitest
- Pattern-Dateien werden zur Runtime gelesen, nie gebundelt
- Logging auf stderr, Ergebnisse auf stdout (Unix-Konvention)

## CLI Befehle

```bash
aios "Natürlichsprachliche Aufgabe"      # Router plant dynamisch
aios run <pattern> [< input]             # Ein Pattern direkt (Fabric-Style)
aios plan "Aufgabe"                      # Nur planen, nicht ausführen
aios patterns list|show <n>           # Pattern Management
```

## Aktueller Fokus: Phase 1

- [ ] Pattern Registry (Frontmatter parsen, Katalog bauen)
- [ ] Provider Abstraction (Claude + Ollama)
- [ ] CLI (`aios run <pattern>` + `aios "Aufgabe"`)
- [ ] Router (Meta-Agent)
- [ ] DAG Engine (parallele Ausführung)
- [ ] Saga Engine (Retry/Rollback)

## Wichtige Konzeptdocs

Architektur & Vision:
- `docs/VISION.md` – Gesamtvision, Prinzipien, Systemübersicht
- `docs/ARCHITECTURE.md` – EIP-Patterns, Message Bus, Provider Abstraction
- `docs/TECHSTACK.md` – Tech-Stack-Entscheidungen, MCP-Server-Integration, Deployment

Kern-Mechanismen:
- `docs/HOW_IT_WORKS.md` – Visuell: Wie das Pattern-System funktioniert (Fabric-Prinzip)
- `docs/PATTERNS.md` – Pattern-Katalog und Kompositions-Spezifikation
- `docs/ROUTER_INSIGHT.md` – Was der Router sieht vs. was ausgeführt wird
- `docs/DYNAMIC.md` – Dynamische Workflow-Orchestrierung (3 Schichten)

Workflow-Patterns:
- `docs/WORKFLOWS.md` – Parallele Workflows: Scatter-Gather, DAG, Saga mit Zeitdiagrammen
- `docs/WORKFLOW_DEFINITIONS.md` – YAML-basierte Workflow-Definitionen (6 Typen)

Team & Compliance:
- `docs/PERSONAS.md` – 8 Persona-Definitionen (RE, Architect, Dev, Tester, Security, Reviewer, TechWriter, QM)
- `docs/KNOWLEDGE.md` – Shared Knowledge Base, Auto-Extraction, Kontext-Injection
- `docs/REGULATED.md` – Traceability, Compliance Reports, Quality Gates, Audit Trail

Planung:
- `docs/PHASES.md` – 5-Phasen Implementierungsplan mit Definition of Done

Referenz-Implementierungen (ausführlich kommentiert):
- `docs/reference/01-basic-pattern-engine.ts` – Fabric-Prinzip in ~100 Zeilen
- `docs/reference/02-parallel-workflows.ts` – Scatter-Gather, DAG, Saga komplett
- `docs/reference/03-dynamic-orchestration.ts` – Router + Registry + Engine komplett
