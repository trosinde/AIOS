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
│   ├── personas.ts     # Persona Registry (lädt YAML-Dateien)
│   ├── router.ts       # Meta-Agent (plant Workflows via LLM)
│   ├── engine.ts       # DAG/Saga Execution Engine
│   ├── repl.ts         # Interaktive Chat-Session (REPL Loop)
│   ├── slash.ts        # Slash-Command Parser (/command --key=value)
│   └── knowledge.ts    # Knowledge Base (SQLite)
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
aios chat [--provider <name>]             # Interaktive Chat-Session (REPL)
aios patterns list                       # Alle Patterns auflisten
aios patterns show <name>                # Pattern-Details anzeigen
```

### Interaktiver Chat-Modus (`aios chat`)

```bash
aios chat [--provider <name>]
```

Startet eine interaktive Session mit Multi-Turn-Konversation und Slash-Commands:

- **Natürliche Sprache:** Einfach lostippen – AIOS antwortet im Chat mit Kontext über alle Turns
- **Pattern-Ausführung:** `/<pattern> [text] [--key=value]` führt ein Pattern direkt aus
- **Built-in Commands:** `/help`, `/patterns`, `/history`, `/clear`, `/exit`
- **Session-History:** Konversationsverlauf wird über Turns hinweg beibehalten (Sliding Window)

## Aktueller Fokus: Phase 1

- [x] Pattern Registry (Frontmatter parsen, Katalog bauen)
- [x] Provider Abstraction (Claude + Ollama)
- [x] CLI (`aios run <pattern>` + `aios "Aufgabe"`)
- [x] Router (Meta-Agent)
- [x] DAG Engine (parallele Ausführung)
- [x] Saga Engine (Retry/Rollback)
- [x] Bug-Fixes (provider.ts, engine.ts, router.ts, cli.ts)
- [x] Tests (vitest, 92 Tests)
- [x] Interactive Chat REPL (`aios chat`, Slash-Commands, Multi-Turn)

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| `docs/VISION.md` | Gesamtvision und Prinzipien |
| `docs/ARCHITECTURE.md` | Komponenten, Datenfluss, Router-Mechanik, EIP-Patterns |
| `docs/PATTERNS.md` | Pattern-Katalog und Kompositions-Regeln |
| `docs/WORKFLOWS.md` | Scatter-Gather, DAG, Saga mit Zeitdiagrammen |
| `docs/PERSONAS.md` | 8 Personas und deren Rollen |
| `docs/PHASES.md` | Implementierungsplan mit Status |
| `docs/REGULATED.md` | Traceability, Compliance, Quality Gates |

Referenz-Implementierungen in `docs/reference/`.
