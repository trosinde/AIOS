# AIOS – AI Orchestration System

CLI-basiertes AI-Orchestrierungssystem. Fabric-Style Patterns + Enterprise Integration Patterns. Natürlichsprachliche Aufgaben werden dynamisch in parallele Workflows zerlegt.

## Quickstart

```bash
npm install
export ANTHROPIC_API_KEY=your-key

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

## Architektur

```
User Input → [Router/Meta-Agent] → Execution Plan (JSON) → [DAG Engine] → Output
```

Drei Schichten:

1. **Pattern Registry** – Markdown-Dateien (`patterns/*/system.md`) mit YAML-Frontmatter. Neue Patterns = neue Datei.
2. **Router** – LLM-Call der Aufgabe + Katalog analysiert → JSON Plan (pipe, scatter-gather, DAG, saga)
3. **Engine** – Mechanische Ausführung: `Promise.all` für Paralleles, Retry/Rollback bei Fehler

## Patterns

Jedes Pattern hat zwei Rollen in einer Datei:

```markdown
---
name: code_review              ← Metadaten (für den Router)
description: "..."
parallelizable_with: [security_review]
---
# IDENTITY and PURPOSE         ← Prompt (für die Ausführung)
Du bist ein Senior Reviewer...
```

Siehe `patterns/` für alle verfügbaren Patterns.

## Docs

- `CLAUDE.md` – Instruktionen für Claude Code
- `docs/` – Konzeptdokumentation (Architektur, Workflows, Patterns)
