# AIOS – AI Orchestration System

## Vision

Ein CLI-basiertes AI-Orchestrierungssystem, das unabhängige AI-Agenten zu einem kohärenten, kollaborativen virtuellen Team vereint. Inspiriert von:

- **Daniel Miessler's Fabric** → Wiederverwendbare Patterns als Tool-Bibliothek
- **Martin Fowler's Enterprise Integration Patterns (EIP)** → Asynchrone, event-basierte Kommunikation zwischen Agenten
- **Agile Softwareentwicklung** → Rollen, Artefakte und Workflows aus regulierten Umfeldern

## Kernprobleme die gelöst werden

| Problem | Lösung | Status |
|---------|--------|--------|
| Agenten arbeiten isoliert, kein Wissenstransfer | Shared Knowledge Base (SQLite) | ✓ Basis implementiert (Vector Store geplant) |
| Manuelles Wechseln zwischen CLI-Tools | Unified CLI als Router/Orchestrator | ✓ Implementiert |
| Inkonsistenzen durch manuelle Übertragung | Single Source of Truth + automatische Synchronisation | ✓ Pattern Registry implementiert |
| Keine dynamische Workflow-Komposition | Pattern-basierte Pipelines mit EIP-Routing | ✓ Router + DAG Engine (Message Bus geplant) |
| Sequentielle statt parallele Arbeit | DAG Engine für parallele Agenten | ✓ Implementiert (Message-Broker geplant) |

## System-Übersicht

```
┌─────────────────────────────────────────────────────┐
│                    AIOS CLI                          │
│              (Unified Entry Point)            [✓]    │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Pattern  │  │  Router  │  │ Workflow │          │
│  │ Registry │  │(Meta-Ag.)│  │ Engine   │          │
│  │   [✓]    │  │   [✓]    │  │   [✓]    │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                │
│       └──────────────┼──────────────┘                │
│              (direkter Aufruf)                       │
│                      │                               │
│  ┌────────────┐  ┌───┴────────┐                     │
│  │ Agent      │  │ Agent      │                     │
│  │ (Claude)   │  │ (Ollama)   │                     │
│  │    [✓]     │  │    [✓]     │                     │
│  └────────────┘  └────────────┘                     │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │        Shared Knowledge Base             │       │
│  │  (Filesystem + SQLite)            [✓]    │       │
│  └──────────────────────────────────────────┘       │
│                                                      │
│  Geplant:                                            │
│  - Message Bus (EIP: Pub/Sub, Routing, DLQ)          │
│  - Vector Store für Knowledge Base                   │
│  - Weitere Provider (OpenAI, etc.)                   │
│  - Persona Registry                                  │
└─────────────────────────────────────────────────────┘

[✓] = implementiert
```

## Dokumentation

| Datei | Inhalt |
|-------|--------|
| `VISION.md` | Dieses Dokument – Vision und Übersicht |
| `ARCHITECTURE.md` | Systemarchitektur mit EIP-Patterns |
| `PHASES.md` | Implementierungsphasenplan |
| `PERSONAS.md` | Virtuelle Team-Definitionen |
| `PATTERNS.md` | Pattern-Katalog und Kompositions-Spezifikation |
| `KNOWLEDGE.md` | Shared Knowledge Management |
| `WORKFLOWS.md` | Workflow-Patterns und Komposition |
| `WORKFLOW_DEFINITIONS.md` | YAML-basierte Workflow-Definitionen |
| `REGULATED.md` | Compliance, Traceability und Reporting |
| `TECHSTACK.md` | Technische Umsetzung |
| `HOW_IT_WORKS.md` | Visuell: Wie das Pattern-System funktioniert |
| `DYNAMIC.md` | Dynamische Workflow-Orchestrierung |
| `ROUTER_INSIGHT.md` | Was der Router sieht vs. was ausgeführt wird |
| `USER_GUIDE.md` | Benutzerhandbuch |

## Prinzipien

1. **CLI-First** – Alles ist über die Kommandozeile steuerbar
2. **Composable** – Kleine, wiederverwendbare Einheiten (Unix-Philosophie)
3. **Event-Driven** – Agenten kommunizieren asynchron über Events
4. **Provider-Agnostic** – Claude, Ollama, OpenAI als austauschbare Backends
5. **Knowledge-Centric** – Geteiltes Wissen als First-Class Citizen
6. **Traceable** – Jede Entscheidung und jedes Artefakt ist nachvollziehbar
7. **Incremental** – Schrittweise aufbaubar, sofort nutzbar
