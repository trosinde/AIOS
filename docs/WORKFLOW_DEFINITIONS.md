# 06 – Workflow-Patterns & Komposition

## EIP-basierte Workflow-Typen

### Typ 1: Pipes & Filters (Sequentiell)

Einfachster Workflow. Daten fließen durch eine Kette von Verarbeitungsschritten.

```
[Input] → [Filter 1] → [Filter 2] → [Filter 3] → [Output]
```

**Anwendung:** Einfache Transformationsketten, Dokument-Verarbeitung.

```yaml
name: document_analysis
type: pipes_and_filters
steps:
  - pattern: summarize
  - pattern: extract_requirements
  - pattern: classify_requirements
  - pattern: generate_tests
```

```bash
# CLI-Äquivalent
cat doc.md | aios run summarize | aios run extract_requirements | aios run classify_requirements
```

---

### Typ 2: Content-Based Router

Dynamisches Routing basierend auf Input-Analyse.

```
                    ┌→ [Bug Fix Workflow]
[Input] → [Router] ─┼→ [Feature Workflow]
                    ├→ [Refactoring Workflow]
                    └→ [Documentation Workflow]
```

**Anwendung:** Intelligente Task-Verteilung.

```yaml
name: smart_router
type: content_based_router
router:
  pattern: classify_input
  rules:
    - condition: "type == 'bug'"
      workflow: bug_fix
    - condition: "type == 'feature'"
      workflow: feature_development
    - condition: "type == 'refactor'"
      workflow: refactoring
    - condition: "type == 'docs'"
      workflow: documentation
    - default:
      workflow: generic_task
```

---

### Typ 3: Scatter-Gather (Parallel)

Aufgabe wird parallel an mehrere Agenten gesendet, Ergebnisse werden aggregiert.

```
                 ┌→ [Agent A] ─┐
[Input] → [Fan] ─┼→ [Agent B] ─┼→ [Aggregator] → [Output]
                 └→ [Agent C] ─┘
```

**Anwendung:** Multi-Perspektiven-Review, parallele Analyse.

```yaml
name: comprehensive_review
type: scatter_gather
scatter:
  - persona: reviewer
    pattern: code_review
  - persona: security_expert
    pattern: security_review
  - persona: architect
    pattern: architecture_review
gather:
  pattern: aggregate_results
  strategy: merge_with_priorities
  conflict_resolution: highest_severity_wins
timeout: 300  # Sekunden
```

---

### Typ 4: Saga (Mehrstufig mit Kompensation)

Komplexe Workflows mit Fehlerbehandlung und Rollback-Fähigkeit.

```
[Step 1] → [Step 2] → [Step 3] → [Step 4]
   ↑          ↑          ↑
   └──────────┴──────────┘  Compensation bei Fehler
```

**Anwendung:** Feature-Entwicklung, Release-Prozesse.

```yaml
name: feature_development
type: saga
max_retries: 2

steps:
  - id: requirements
    persona: re
    pattern: extract_requirements
    compensate: null  # Kein Rollback nötig
    
  - id: design
    persona: architect
    pattern: design_solution
    depends_on: [requirements]
    compensate: null
    quality_gate:
      pattern: architecture_review
      min_score: 7
    
  - id: implement
    persona: developer
    pattern: generate_code
    depends_on: [design]
    compensate:
      action: revert_to_design
      notify: [architect, developer]
    
  - id: test
    persona: tester
    pattern: generate_tests
    depends_on: [implement]
    on_failure:
      strategy: retry_with_feedback
      feedback_to: developer
      max_retries: 2
    
  - id: review
    type: scatter_gather
    depends_on: [implement]
    scatter:
      - persona: reviewer
        pattern: code_review
      - persona: security_expert
        pattern: security_review
    gather:
      pattern: aggregate_results
    on_failure:
      strategy: send_back
      feedback_to: developer
      goto: implement
    
  - id: report
    persona: quality_manager
    pattern: compliance_report
    depends_on: [test, review]
    artifacts:
      - test_report
      - coverage_matrix
      - security_assessment
```

---

### Typ 5: Process Manager (Zustandsbasiert)

Komplexer Workflow mit State Machine und bedingten Übergängen.

```yaml
name: regulated_development
type: process_manager

states:
  draft:
    entry_action: create_task_record
    transitions:
      - on: requirements_complete
        to: designed
        guard: "requirements.count > 0"
  
  designed:
    entry_action: notify_developer
    transitions:
      - on: design_approved
        to: implementing
      - on: design_rejected
        to: draft
  
  implementing:
    entry_action: start_implementation
    transitions:
      - on: code_complete
        to: reviewing
      - on: blocked
        to: designed
  
  reviewing:
    entry_action: start_parallel_review
    type: scatter_gather
    parallel_tasks:
      - code_review
      - security_review
    transitions:
      - on: all_approved
        to: testing
      - on: any_rejected
        to: implementing
  
  testing:
    entry_action: run_test_suite
    transitions:
      - on: tests_passed
        to: reporting
      - on: tests_failed
        to: implementing
  
  reporting:
    entry_action: generate_compliance_report
    transitions:
      - on: report_complete
        to: done
  
  done:
    entry_action: archive_artifacts
    type: final
```

---

### Typ 6: Event-Driven (Reaktiv)

Agenten reagieren autonom auf Events. Kein zentraler Orchestrator.

```yaml
name: reactive_team
type: event_driven

subscriptions:
  - agent: tester
    on: code-changed
    action:
      pattern: generate_tests
      then_publish: test-results
  
  - agent: reviewer
    on: code-changed
    action:
      pattern: code_review
      then_publish: review-feedback
  
  - agent: security_expert
    on: code-changed
    action:
      pattern: security_review
      then_publish: security-assessment
  
  - agent: tech_writer
    on: review-approved
    action:
      pattern: generate_docs
      then_publish: docs-updated
  
  - agent: quality_manager
    on: [test-results, review-feedback, security-assessment]
    wait_for_all: true
    action:
      pattern: quality_gate_check
      then_publish: quality-gate-result
  
  - agent: developer
    on: [review-feedback, test-failed]
    action:
      pattern: apply_feedback
      then_publish: code-changed  # → Triggers neuer Zyklus
```

---

## Workflow-Komposition (Interaktiv)

```bash
# Interaktiver Workflow-Builder
aios compose

# > Wie heißt dein Workflow? feature_review
# > Beschreibe was passieren soll: 
# >   "Code soll parallel von 3 Perspektiven reviewt werden,
# >    dann Ergebnisse zusammengeführt und ein Report erstellt werden"
# 
# AIOS analysiert und schlägt vor:
# 
# Vorgeschlagener Workflow:
# ┌─────────────────────────────────────────────┐
# │  Typ: Scatter-Gather + Pipes               │
# │                                             │
# │  1. [Scatter]                               │
# │     ├── Code Review (reviewer)              │
# │     ├── Security Review (security_expert)   │
# │     └── Architecture Review (architect)     │
# │  2. [Gather] → Aggregate Results            │
# │  3. [Pipe] → Generate Report                │
# └─────────────────────────────────────────────┘
# 
# Soll ich diesen Workflow erstellen? [Y/n]
```

## Workflow-Ausführung und Monitoring

```bash
# Workflow starten
aios workflow run feature_development --input="Implementiere OAuth 2.0 für API"

# Status beobachten (live)
aios workflow watch task-042

# Output:
# ══════════════════════════════════════════════════
# Workflow: feature_development (task-042)
# Status: RUNNING (Step 3/6)
# Started: 14:30:00 | Elapsed: 00:04:32
# ══════════════════════════════════════════════════
# 
# ✅ requirements   │ RE              │ 12 Requirements extrahiert
# ✅ design         │ Architect       │ API Design + ADR erstellt
# 🔄 implement      │ Developer       │ 60% (4/7 Module)
# ⏳ review         │ Reviewer + Sec  │ Wartet auf implement
# ⏳ test           │ Tester          │ Wartet auf implement
# ⏳ report         │ QA Manager      │ Wartet auf review + test
# ──────────────────────────────────────────────────
# Token Usage: 12,450 | Estimated: 25,000
# Cost (est.): $0.38

# Workflow-Ergebnis abrufen
aios workflow result task-042

# Alle Workflows anzeigen
aios workflow list
```

## Vordefinierte Workflows

| Workflow | Typ | Beschreibung |
|----------|-----|-------------|
| `quick_review` | Scatter-Gather | Schnelles Multi-Review |
| `feature_development` | Saga | Vollständiger Feature-Zyklus |
| `bug_fix` | Pipes & Filters | Bug-Analyse → Fix → Test |
| `documentation` | Pipes & Filters | Docs erstellen und reviewen |
| `security_assessment` | Process Manager | Vollständige Security-Analyse |
| `compliance_check` | Saga | Compliance-Prüfung gegen Standard |
| `smart_task` | Content-Based Router | Automatische Aufgaben-Klassifikation |
| `reactive_team` | Event-Driven | Autonomes Team-Setup |
