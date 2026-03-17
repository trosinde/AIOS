# AIOS – AI Orchestration System

CLI-basiertes AI-Orchestrierungssystem. Natürlichsprachliche Aufgaben werden dynamisch in parallele Workflows aus wiederverwendbaren Patterns zerlegt.

```
User Input → [Router/Meta-Agent] → Execution Plan → [DAG Engine] → Output
```

## Quickstart

```bash
git clone https://github.com/trosinde/AIOS.git && cd AIOS
npm install
export ANTHROPIC_API_KEY=your-key

# Ein Pattern direkt ausführen
echo "Langer Text..." | npx tsx src/cli.ts run summarize

# Dynamisch: Router plant den Workflow automatisch
npx tsx src/cli.ts "Review diesen Code auf Security und Qualität"

# Patterns auflisten
npx tsx src/cli.ts patterns list
```

## Features

- **30 Patterns** in 7 Kategorien (analyze, generate, review, transform, report, tool, meta)
- **Dynamische Workflows** – Router plant automatisch: pipe, scatter-gather, DAG, saga
- **Parallele Ausführung** – Unabhängige Steps laufen gleichzeitig
- **Tool-Patterns** – CLI-Tools (Mermaid, Bildgenerierung) als Teil von Workflows
- **Pattern-Parameterisierung** – `aios run pattern --key=value`
- **Unix-Pipes** – `aios run p1 | aios run p2`
- **Multi-Provider** – Claude (Anthropic) + Ollama (lokal)
- **Retry/Escalation** – Fehlerbehandlung mit Feedback-Loop
- **Tool-Sicherheit** – Allowlist für CLI-Tool-Ausführung

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| **[User Guide](docs/USER_GUIDE.md)** | Installation, alle Befehle, Praxis-Rezepte, Konfiguration, Troubleshooting |
| **[Architektur](docs/ARCHITECTURE.md)** | Systemübersicht, Komponenten, Datenfluss, Erweiterungspunkte |

### Konzeptdokumentation

| Dokument | Inhalt |
|----------|--------|
| [Patterns](docs/PATTERNS.md) | Pattern-Spezifikation und vollständiger Katalog |
| [Workflows](docs/WORKFLOWS.md) | Workflow-Typen mit Zeitdiagrammen |
| [Personas](docs/PERSONAS.md) | 8 Persona-Definitionen |
| [Phases](docs/PHASES.md) | 5-Phasen Implementierungsplan |

## Lizenz

MIT
