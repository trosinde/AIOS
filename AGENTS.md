# AIOS – AI Orchestration System

## Projektkontext

CLI-basiertes AI-Orchestrierungssystem. Fabric-Style Patterns + Enterprise Integration Patterns. Natürlichsprachliche Aufgaben werden dynamisch in parallele Workflows zerlegt.

## Architektur

```
User Input → [Router/Meta-Agent] → Execution Plan (JSON) → [DAG Engine] → Output
```

Drei Schichten: Pattern Registry (Markdown), Router (LLM-Call), Engine (mechanische Ausführung).

## Entwicklungsrichtlinien

- TypeScript strict mode, ESM modules
- Alle I/O async/await
- Keine Klassen wo Funktionen reichen, aber Interfaces für alle Datenstrukturen
- Tests mit vitest
- Pattern-Dateien werden zur Runtime gelesen, nie gebundelt
- Logging auf stderr, Ergebnisse auf stdout (Unix-Konvention)
- Neue Patterns = neue Markdown-Datei in patterns/, kein Code-Change

## Projektstruktur

Lies `CLAUDE.md` für die vollständige Projektstruktur und offene Tasks.

## Wichtige Regeln

- Patterns haben YAML-Frontmatter (Metadaten für Router) + Markdown-Prompt (für LLM)
- Der Router ist selbst ein LLM-Call — kein hardcoded Routing
- Die Engine kennt keine AI — sie führt nur den Plan mechanisch aus
- Provider-Abstraktion: `complete(system, user) → LLMResponse` — egal welches Backend

## AIOS als MCP-Server

AIOS kann als MCP-Server gestartet werden: `aios mcp-server`

Exponierte Tools:
- `aios_run` – Einzelnes Pattern ausführen
- `aios_orchestrate` – Dynamische Orchestrierung
- `aios_patterns` – Pattern-Katalog abfragen
- `aios_plan` – Workflow planen ohne auszuführen

## Verfügbare CLI-Commands

```bash
aios "Natürlichsprachliche Aufgabe"      # Router plant dynamisch
aios run <pattern> [< input]             # Einzelnes Pattern (Fabric-Style)
aios plan "Aufgabe"                      # Nur planen
aios chat                                # Interaktive REPL
aios mcp-server                          # MCP-Server (stdio)
aios patterns list                       # Alle Patterns
aios patterns show <name>               # Pattern-Details
```
