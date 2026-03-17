# 05 – Shared Knowledge Management

## Das Kernproblem

Aktuell geht bei jedem Agenten-Wechsel Kontext verloren. Wissen muss manuell übertragen werden, was zu Inkonsistenzen führt. Die Knowledge Base löst das durch:

1. **Automatische Extraktion** – Jeder Agent-Output wird auf Wissen gescannt
2. **Zentrale Speicherung** – Ein Ort für alles Wissen
3. **Kontextuelle Injection** – Relevantes Wissen wird automatisch zum Prompt hinzugefügt
4. **Versionierung** – Wissen entwickelt sich weiter und ist nachvollziehbar

## Architektur

```
Agent Output
     │
     ▼
┌──────────────┐
│  Extractor   │  ← Meta-Pattern "extract_knowledge"
│  (Auto)      │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────┐
│          Knowledge Base                   │
│                                           │
│  ┌─────────────┐  ┌──────────────┐       │
│  │ Vector Store │  │   SQLite     │       │
│  │ (Semantic)   │  │ (Structured) │       │
│  │              │  │              │       │
│  │ - Embeddings │  │ - Decisions  │       │
│  │ - Concepts   │  │ - Facts      │       │
│  │ - Context    │  │ - Relations  │       │
│  └──────┬──────┘  └──────┬───────┘       │
│         │                │               │
│  ┌──────┴────────────────┴───────┐       │
│  │        Filesystem             │       │
│  │  - Artefakte (Code, Docs)     │       │
│  │  - Reports                    │       │
│  │  - Traceability Links         │       │
│  └───────────────────────────────┘       │
│                                           │
│  ┌───────────────────────────────┐       │
│  │        Git Repository         │       │
│  │  - Versionshistorie           │       │
│  │  - Change Tracking            │       │
│  └───────────────────────────────┘       │
└──────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│  Retriever   │  ← Bei jedem neuen Agent-Aufruf
│  (Auto)      │
└──────┬───────┘
       │
       ▼
  Agent Prompt
  (+ relevanter Kontext)
```

## Knowledge-Typen

### 1. Decisions (Entscheidungen)

```yaml
type: decision
id: "DEC-2026-001"
date: "2026-03-17"
context: "API-Design für Modul X"
decision: "REST statt gRPC wegen bestehender Client-Infrastruktur"
rationale: "80% der Clients unterstützen nur HTTP/REST..."
alternatives_considered:
  - "gRPC: Schneller, aber Client-Umbau nötig"
  - "GraphQL: Flexibel, aber Overhead für einfache CRUD-Ops"
decided_by: architect
impacts:
  - requirement: "REQ-042"
  - component: "api-gateway"
status: active
```

### 2. Facts (Fakten / Kontext)

```yaml
type: fact
id: "FACT-001"
category: "technology"
content: "Projekt nutzt Python 3.12 mit FastAPI als Web-Framework"
source: "architect"
confidence: high
valid_until: null  # permanent bis widerrufen
tags: [python, fastapi, technology-stack]
```

### 3. Requirements (Anforderungen)

```yaml
type: requirement
id: "REQ-042"
title: "Sichere API-Authentifizierung"
description: "Alle API-Endpunkte müssen via OAuth 2.0 geschützt sein"
acceptance_criteria:
  - "JWT-Token-Validierung bei jedem Request"
  - "Token-Expiry max. 1 Stunde"
  - "Refresh-Token-Mechanismus implementiert"
priority: high
risk: high
source: "security_requirements_doc.md"
traces_to:
  design: ["DES-012"]
  code: ["auth_middleware.py"]
  tests: ["TEST-042-001", "TEST-042-002", "TEST-042-003"]
status: implemented
```

### 4. Artifacts (Artefakte)

```yaml
type: artifact
id: "ART-001"
name: "auth_middleware.py"
path: "projects/current/src/auth_middleware.py"
artifact_type: code
language: python
created_by: developer
version: "1.2"
implements:
  - "REQ-042"
reviewed_by: reviewer
review_status: approved
```

## Automatische Knowledge-Extraktion

Nach jedem Agent-Aufruf wird der Output durch das `extract_knowledge`-Pattern geleitet:

```yaml
# Meta-Pattern: extract_knowledge
---
name: extract_knowledge
category: meta
description: "Extrahiert Wissensitems aus Agent-Output"
---

Analysiere den folgenden Agent-Output und extrahiere:

1. DECISIONS: Getroffene Entscheidungen mit Begründung
2. FACTS: Neue Fakten oder Erkenntnisse
3. REQUIREMENTS: Neue oder geänderte Anforderungen
4. ARTIFACTS: Erstellte oder referenzierte Artefakte
5. OPEN_QUESTIONS: Offene Fragen oder Lücken
6. RELATIONS: Beziehungen zwischen Entitäten (traces_to, depends_on, etc.)

Antworte AUSSCHLIESSLICH im JSON-Format.
```

## Kontext-Injection

Bevor ein Agent eine Aufgabe bearbeitet, werden relevante Knowledge-Items abgerufen und als Kontext injiziert:

```
┌──────────────────────────────────────────┐
│  Agent Prompt Aufbau                      │
├──────────────────────────────────────────┤
│  1. Persona System Prompt                │
│  2. Relevante Entscheidungen (Decisions)  │
│  3. Relevante Fakten (Facts)              │
│  4. Zugehörige Requirements               │
│  5. Verknüpfte Artefakte (Referenzen)     │
│  6. Aktuelle Aufgabe (User Input)         │
└──────────────────────────────────────────┘
```

### Retrieval-Strategie

```python
def get_context(task_description, persona, project):
    context = []
    
    # 1. Semantische Suche über Vector Store
    semantic_results = vector_store.search(
        query=task_description,
        top_k=10,
        filter={"project": project}
    )
    
    # 2. Strukturierte Suche über SQLite
    # Entscheidungen die noch aktiv sind
    active_decisions = db.query(
        "SELECT * FROM decisions WHERE status='active' AND project=?",
        project
    )
    
    # 3. Traceability-Links verfolgen
    related_requirements = db.query(
        "SELECT * FROM requirements WHERE id IN "
        "(SELECT req_id FROM traces WHERE artifact_id IN ?)",
        [r.id for r in semantic_results if r.type == 'artifact']
    )
    
    # 4. Persona-spezifischer Filter
    context = filter_for_persona(
        items=semantic_results + active_decisions + related_requirements,
        persona=persona
    )
    
    # 5. Token-Budget einhalten
    context = trim_to_budget(context, max_tokens=4000)
    
    return context
```

## CLI-Befehle

```bash
# Wissen suchen
aios knowledge search "authentication API design"

# Wissen hinzufügen
aios knowledge add --type=decision --content="..."

# Wissen aus Datei importieren
aios knowledge import meeting_notes.md

# Knowledge-Status anzeigen
aios knowledge stats
# Output:
# ┌────────────────────────────┐
# │ Knowledge Base Statistics   │
# ├──────────────┬─────────────┤
# │ Decisions    │          42 │
# │ Facts        │         128 │
# │ Requirements │          67 │
# │ Artifacts    │          89 │
# │ Relations    │         234 │
# │ Last Updated │ 5 min ago   │
# └──────────────┴─────────────┘

# Traceability prüfen
aios knowledge trace REQ-042
# Output:
# REQ-042: Sichere API-Authentifizierung
# ├── Design: DES-012 (Architect, 2026-03-10)
# ├── Code: auth_middleware.py v1.2 (Developer, 2026-03-12)
# ├── Tests:
# │   ├── TEST-042-001: JWT Validation ✅
# │   ├── TEST-042-002: Token Expiry ✅
# │   └── TEST-042-003: Refresh Token ✅
# ├── Review: Approved (Reviewer, 2026-03-14)
# └── Security: Passed (Security Expert, 2026-03-15)

# Inkonsistenzen finden
aios knowledge check --consistency
```

## Projektkontext

Jedes Projekt hat seinen eigenen Knowledge-Scope:

```
~/.aios/projects/
├── project-alpha/
│   ├── knowledge.db       # SQLite für dieses Projekt
│   ├── vectors/           # ChromaDB Collection
│   ├── artifacts/         # Generierte Artefakte
│   ├── decisions/         # ADRs
│   └── context.yaml       # Projektkonfiguration
└── project-beta/
    └── ...
```

```yaml
# projects/project-alpha/context.yaml
name: "Project Alpha"
description: "Sensor Data Processing Module"
standards:
  - IEC 62443
  - EU CRA
technology_stack:
  language: python
  framework: fastapi
  database: postgresql
team_config:
  personas: [re, architect, developer, tester, security_expert, quality_manager]
  default_provider: claude
knowledge_retention:
  auto_extract: true
  max_context_tokens: 4000
  embedding_model: "text-embedding-3-small"
```
