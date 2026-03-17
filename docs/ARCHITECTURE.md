# 01 – Systemarchitektur

## Enterprise Integration Patterns für AI-Agenten

Die Architektur basiert auf Martin Fowler's / Gregor Hohpe's Enterprise Integration Patterns, adaptiert für AI-Agent-Kommunikation.

## Kernkomponenten

### 1. Message Bus

Der zentrale Kommunikationskanal zwischen allen Agenten. Implementiert als dateisystembasierte Message Queue (für CLI-Kompatibilität).

```
~/.aios/
├── bus/
│   ├── inbox/           # Eingehende Nachrichten pro Agent
│   │   ├── architect/
│   │   ├── developer/
│   │   ├── tester/
│   │   └── reviewer/
│   ├── topics/          # Pub/Sub Topics
│   │   ├── code-changed/
│   │   ├── review-requested/
│   │   ├── tests-failed/
│   │   └── requirement-updated/
│   └── dead-letter/     # Fehlgeschlagene Nachrichten
├── knowledge/           # Shared Knowledge Base
├── patterns/            # Tool/Pattern Library
├── personas/            # Persona Definitionen
├── workflows/           # Workflow Definitionen
├── projects/            # Projektspezifischer Kontext
└── config.yaml          # Globale Konfiguration
```

### 2. Message Format

Jede Nachricht zwischen Agenten folgt einem einheitlichen Schema:

```yaml
id: "msg-2026-03-17-001"
timestamp: "2026-03-17T14:30:00Z"
source: "architect"
target: "developer"           # oder "*" für broadcast
topic: "code-changed"
correlation_id: "task-042"    # Verknüpfung zusammengehöriger Nachrichten
payload:
  type: "review_request"
  content: "..."
  artifacts:
    - path: "projects/current/design.md"
  context:
    requirement_id: "REQ-042"
    priority: "high"
metadata:
  model_used: "claude-sonnet-4-20250514"
  tokens_used: 1542
  pattern_used: "code_review"
```

### 3. EIP Pattern Mapping

| EIP Pattern | AI-Workflow Anwendung | Implementierung |
|-------------|----------------------|-----------------|
| **Message Router** | Aufgabe an richtigen Agenten leiten | CLI Router analysiert Task und wählt Persona |
| **Content-Based Router** | Routing basierend auf Inhalt | LLM klassifiziert Input → wählt Pattern/Agent |
| **Publish-Subscribe** | Mehrere Agenten reagieren auf Event | Filesystem-Watcher auf Topic-Verzeichnissen |
| **Message Filter** | Irrelevante Nachrichten filtern | Agent prüft ob Nachricht relevant ist |
| **Aggregator** | Ergebnisse mehrerer Agenten zusammenführen | Orchestrator sammelt und konsolidiert |
| **Splitter** | Große Aufgabe in Teilaufgaben zerlegen | Decomposition-Pattern teilt Task auf |
| **Saga Pattern** | Mehrstufige Workflows mit Rollback | Workflow-Engine mit State Machine |
| **Dead Letter Queue** | Fehlgeschlagene Verarbeitungen | Retry-Mechanismus + manuelles Review |
| **Pipes and Filters** | Sequentielle Verarbeitung | Unix-Pipe-kompatible Pattern-Ketten |
| **Scatter-Gather** | Parallele Bearbeitung, dann Aggregation | Fan-out an Agenten, Collect-Phase |
| **Process Manager** | Komplexe Workflow-Steuerung | State Machine mit Entscheidungslogik |

## Architektur-Layer

### Layer 1: CLI Interface

```
aios <command> [options]

Befehle:
  aios run <pattern>              # Einzelnes Pattern ausführen
  aios ask <persona> "<task>"     # Persona direkt ansprechen
  aios workflow <name>            # Definierten Workflow starten
  aios compose                    # Interaktiver Workflow-Builder
  aios team <task>                # Aufgabe ans Team delegieren
  aios status                     # Laufende Tasks anzeigen
  aios knowledge search <query>   # Wissensbasis durchsuchen
  aios knowledge add <file>       # Wissen hinzufügen
```

### Layer 2: Router / Orchestrator

Der Router entscheidet basierend auf dem Input:

```
Input → [Classifier LLM] → Route Decision
                              ├── Single Pattern (Pipes & Filters)
                              ├── Single Persona (Direct Message)
                              ├── Workflow (Process Manager)
                              └── Team Task (Scatter-Gather)
```

**Classifier Prompt (Meta-Agent):**
```
Du bist der AIOS Router. Analysiere die folgende Aufgabe und entscheide:
1. Welche Personas werden benötigt?
2. Welche Patterns sind relevant?
3. Welcher Workflow-Typ passt?
4. Können Teile parallel bearbeitet werden?
5. Welche Abhängigkeiten bestehen?

Antworte im JSON-Format mit deinem Routing-Plan.
```

### Layer 3: Agent Runtime

Jeder Agent wird als isolierter Prozess gestartet:

```
┌─────────────────────────────┐
│         Agent Runtime        │
├─────────────────────────────┤
│ Persona Context (System)     │  ← Rolle, Fähigkeiten, Constraints
│ Task Context (User)          │  ← Aktuelle Aufgabe
│ Knowledge Context            │  ← Relevantes Wissen aus KB
│ Tool Access                  │  ← Verfügbare Patterns/Tools
│ Output Handler               │  ← Ergebnis → Bus + Knowledge
└─────────────────────────────┘
```

### Layer 4: Knowledge & Persistence

```
Knowledge Base
├── Vector Store (Embeddings)  → Semantische Suche
├── SQLite (Structured)        → Tasks, Decisions, Traceability
├── Filesystem (Artifacts)     → Code, Docs, Reports
└── Git (Versioning)           → Änderungshistorie
```

## Kommunikationsmuster

### Pattern A: Pipes & Filters (sequentiell)
```
Input → [Extract Requirements] → [Design API] → [Generate Code] → [Review] → Output
```

### Pattern B: Scatter-Gather (parallel)
```
                 ┌→ [Security Review]  ─┐
Input → [Split] ─┼→ [Code Quality]     ─┼→ [Aggregate] → Output
                 └→ [Architecture Check]─┘
```

### Pattern C: Saga (mehrstufig mit Kompensation)
```
[Analyze] → [Design] → [Implement] → [Test]
    ↑           ↑           ↑          │
    └───────────┴───────────┴──────────┘  (bei Fehler: Rollback/Rework)
```

### Pattern D: Event-Driven (reaktiv)
```
[Developer] → publishes "code-changed"
                  │
                  ├→ [Tester] subscribes → runs tests → publishes "test-results"
                  ├→ [Reviewer] subscribes → reviews code → publishes "review-done"
                  └→ [Doc-Writer] subscribes → updates docs
```

## Provider Abstraction

```yaml
# config.yaml
providers:
  claude:
    type: anthropic
    model: claude-sonnet-4-20250514
    api_key_env: ANTHROPIC_API_KEY
    use_for:
      - complex_reasoning
      - architecture_decisions
      - code_review
  
  ollama-fast:
    type: ollama
    model: qwen3:235b
    endpoint: http://jarvis:11434
    use_for:
      - classification
      - extraction
      - simple_transforms
  
  ollama-code:
    type: ollama
    model: qwen2.5-coder:32b
    endpoint: http://jarvis:11434
    use_for:
      - code_generation
      - refactoring
      - unit_tests

routing_rules:
  - pattern: "classify_*"
    provider: ollama-fast
  - pattern: "architect_*"
    provider: claude
  - pattern: "generate_code_*"
    provider: ollama-code
  - default: claude
```
