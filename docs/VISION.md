# AIOS – AI Orchestration System

## Vision

Ein CLI-basiertes AI-Orchestrierungssystem, das unabhängige AI-Agenten zu einem kohärenten, kollaborativen virtuellen Team vereint. Inspiriert von:

- **Daniel Miessler's Fabric** → Wiederverwendbare Patterns als Tool-Bibliothek
- **Martin Fowler's Enterprise Integration Patterns (EIP)** → Asynchrone, event-basierte Kommunikation zwischen Agenten
- **Agile Softwareentwicklung** → Rollen, Artefakte und Workflows aus regulierten Umfeldern

## Kernprobleme die gelöst werden

| Problem | Lösung |
|---------|--------|
| Agenten arbeiten isoliert, kein Wissenstransfer | Shared Knowledge Base mit Event-Bus |
| Manuelles Wechseln zwischen CLI-Tools | Unified CLI als Router/Orchestrator |
| Inkonsistenzen durch manuelle Übertragung | Single Source of Truth + automatische Synchronisation |
| Keine dynamische Workflow-Komposition | Pattern-basierte Pipelines mit EIP-Routing |
| Sequentielle statt parallele Arbeit | Message-Broker-Pattern für parallele Agenten |

## System-Übersicht

```
┌─────────────────────────────────────────────────────┐
│                    AIOS CLI                          │
│              (Unified Entry Point)                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Pattern  │  │ Persona  │  │ Workflow │          │
│  │ Registry │  │ Registry │  │ Engine   │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                │
│  ┌────┴──────────────┴──────────────┴────┐          │
│  │         Message Bus (EIP)             │          │
│  │   (Pub/Sub, Routing, Saga, DLQ)       │          │
│  └────┬──────────────┬──────────────┬────┘          │
│       │              │              │                │
│  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐          │
│  │ Agent 1  │  │ Agent 2  │  │ Agent N  │          │
│  │(Claude)  │  │(Ollama)  │  │(OpenAI)  │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │        Shared Knowledge Base             │       │
│  │  (Filesystem + SQLite + Vector Store)    │       │
│  └──────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────┘
```

## Dateistruktur dieses Konzepts

| Datei | Inhalt |
|-------|--------|
| `README.md` | Dieses Dokument – Vision und Übersicht |
| `01-ARCHITECTURE.md` | Systemarchitektur mit EIP-Patterns |
| `02-PHASES.md` | Implementierungsphasenplan |
| `03-PERSONAS.md` | Virtuelle Team-Definitionen |
| `04-TOOLS.md` | Tool-Bibliothek und Pattern-Spezifikation |
| `05-KNOWLEDGE.md` | Shared Knowledge Management |
| `06-WORKFLOWS.md` | Workflow-Patterns und Komposition |
| `07-REGULATED.md` | Compliance, Traceability und Reporting |
| `08-TECHSTACK.md` | Technische Umsetzung mit Claude Code / OpenCode |

## Prinzipien

1. **CLI-First** – Alles ist über die Kommandozeile steuerbar
2. **Composable** – Kleine, wiederverwendbare Einheiten (Unix-Philosophie)
3. **Event-Driven** – Agenten kommunizieren asynchron über Events
4. **Provider-Agnostic** – Claude, Ollama, OpenAI als austauschbare Backends
5. **Knowledge-Centric** – Geteiltes Wissen als First-Class Citizen
6. **Traceable** – Jede Entscheidung und jedes Artefakt ist nachvollziehbar
7. **Incremental** – Schrittweise aufbaubar, sofort nutzbar
