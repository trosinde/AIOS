# 02 – Phasenplan

## Übersicht

Der Aufbau erfolgt inkrementell in 5 Phasen. Jede Phase liefert sofort nutzbaren Mehrwert.

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
Foundation   Patterns    Personas    Workflows    Team
(2 Wochen)  (2 Wochen)  (3 Wochen)  (3 Wochen)  (ongoing)
```

---

## Phase 1: Foundation (Wochen 1–2)

**Ziel:** CLI-Grundgerüst, Verzeichnisstruktur, Konfiguration, erster nutzbarer Prototyp.

### Deliverables

- [x] AIOS Projektstruktur (src/, patterns/, docs/)
- [x] CLI Entry Point (Commander.js + chalk)
- [x] `aios.yaml` mit Provider-Konfiguration (Claude API + Ollama)
- [x] 13 Patterns implementiert (summarize, code_review, security_review, etc.)
- [x] `aios run <pattern>` funktioniert mit Pipe-Input
- [ ] Knowledge Base Grundstruktur (better-sqlite3, geplant Phase 3)

### Technische Schritte

```bash
# 1. Repository klonen & Dependencies installieren
git clone https://github.com/trosinde/AIOS.git && cd AIOS
npm install

# 2. API Key setzen
export ANTHROPIC_API_KEY=your-key

# 3. Erster Test
echo "Analyse diese Architektur..." | npx tsx src/cli.ts run summarize
```

### Definition of Done Phase 1
- `aios run <pattern>` funktioniert mit stdin/stdout
- Mindestens 3 Patterns sind nutzbar
- Provider-Switching zwischen Claude und Ollama funktioniert
- Logging auf stderr (Unix-Konvention)

---

## Phase 2: Pattern Library (Wochen 3–4)

**Ziel:** Umfangreiche Tool-Bibliothek, Pattern-Komposition, Auto-Discovery.

### Deliverables

- [ ] Pattern-Spezifikationsformat definiert (YAML + Markdown)
- [ ] 15+ Patterns implementiert (siehe `04-TOOLS.md`)
- [ ] Pattern-Discovery: `aios patterns list`, `aios patterns search <query>`
- [ ] Pattern-Komposition über Pipes: `aios run p1 | aios run p2`
- [ ] Pattern-Parameterisierung: `aios run review_code --language=python --standard=iec62443`
- [ ] Custom Pattern Creator: `aios patterns create <name>`
- [ ] Pattern-Versionierung (Git-basiert)

### Pattern-Kategorien

```
patterns/
├── analyze/          # Analyse-Patterns
│   ├── extract_requirements.md
│   ├── identify_risks.md
│   └── gap_analysis.md
├── generate/         # Generierungs-Patterns
│   ├── generate_code.md
│   ├── generate_tests.md
│   └── generate_docs.md
├── review/           # Review-Patterns
│   ├── code_review.md
│   ├── security_review.md
│   └── architecture_review.md
├── transform/        # Transformations-Patterns
│   ├── summarize.md
│   ├── translate.md
│   └── refactor.md
└── report/           # Reporting-Patterns
    ├── test_report.md
    ├── coverage_report.md
    └── compliance_report.md
```

### Definition of Done Phase 2
- 15+ Patterns nutzbar und dokumentiert
- Pattern-Komposition über Pipes funktioniert
- Custom Patterns können erstellt werden
- Pattern-Suche funktioniert

---

## Phase 3: Personas & Knowledge (Wochen 5–7)

**Ziel:** Virtuelle Teammitglieder mit Rollen, geteiltes Wissen, Kontextmanagement.

### Deliverables

- [ ] Persona-Spezifikationsformat definiert (YAML)
- [ ] 8+ Personas implementiert (siehe `03-PERSONAS.md`)
- [ ] `aios ask <persona> "<aufgabe>"` funktioniert
- [ ] Knowledge Base (better-sqlite3, ggf. Vektor-Suche)
- [ ] Automatischer Knowledge-Import aus Agent-Outputs
- [ ] Kontext-Injection: Relevantes Wissen wird automatisch zum Prompt hinzugefügt
- [ ] Persona-Memory: Agenten erinnern sich an projektspezifische Entscheidungen

### Knowledge Flow

```
Agent Output ──→ [Extractor] ──→ Knowledge Base
                                      │
                                      ↓
                              [Relevance Search]
                                      │
                                      ↓
                              Context für nächsten Agent
```

### Definition of Done Phase 3
- Personas sind ansprechbar und antworten rollenkonform
- Wissen wird automatisch extrahiert und gespeichert
- Kontext-Injection liefert relevantes Wissen zum Prompt
- Cross-Agent-Wissenstransfer funktioniert ohne manuelle Übertragung

---

## Phase 4: Workflows & Orchestrierung (Wochen 8–10)

**Ziel:** Definierte Workflows, EIP-Patterns, parallele Ausführung, Saga-Support.

### Deliverables

- [ ] Workflow-Definition-Format (YAML-basiert)
- [ ] `aios workflow run <name>` startet definierten Workflow
- [ ] `aios compose` für interaktive Workflow-Erstellung
- [ ] Message Bus implementiert (Filesystem-basiert)
- [ ] Pub/Sub für Topic-basierte Kommunikation
- [ ] Scatter-Gather für parallele Agent-Ausführung
- [ ] Saga-Pattern mit Rollback-Fähigkeit
- [ ] Status-Tracking: `aios status` zeigt laufende Workflows
- [ ] Workflow-Visualisierung (Mermaid-Output)

### Workflow-Definition

```yaml
# workflows/feature_development.yaml
name: feature_development
description: "Vollständiger Feature-Entwicklungszyklus"
trigger: manual

steps:
  - id: analyze
    persona: requirements_engineer
    pattern: extract_requirements
    input: "${trigger.input}"
    output_to: knowledge

  - id: design
    persona: architect
    pattern: design_solution
    depends_on: [analyze]
    input_from: [analyze.output]

  - id: implement
    type: scatter-gather
    depends_on: [design]
    parallel:
      - persona: developer
        pattern: generate_code
        input_from: [design.output]
      - persona: developer
        pattern: generate_tests
        input_from: [design.output, analyze.output]

  - id: review
    type: scatter-gather
    depends_on: [implement]
    parallel:
      - persona: reviewer
        pattern: code_review
      - persona: security_expert
        pattern: security_review

  - id: test
    persona: tester
    pattern: run_test_suite
    depends_on: [implement]
    on_failure:
      goto: implement
      max_retries: 2

  - id: report
    persona: quality_manager
    pattern: compliance_report
    depends_on: [review, test]
    artifacts:
      - test_report
      - coverage_matrix
      - review_summary
```

### Definition of Done Phase 4
- Workflows können definiert und ausgeführt werden
- Parallele Ausführung funktioniert
- Fehlerbehandlung mit Retry/Rollback
- Status-Tracking und Visualisierung

---

## Phase 5: Virtual Team Operations (ab Woche 11, ongoing)

**Ziel:** Vollwertiges virtuelles Entwicklungsteam für regulierte Umgebungen.

### Deliverables

- [ ] Vollständiger Requirements-to-Test-Traceability-Workflow
- [ ] Automatische Test-Report-Generierung
- [ ] Requirements-Coverage-Matrix
- [ ] Review-Protokolle mit Audit-Trail
- [ ] Integration mit externen Tools (Git, Jira-Export, Azure DevOps-Export)
- [ ] Team-Dashboard (CLI-basiert)
- [ ] Continuous Improvement: Patterns werden basierend auf Nutzung optimiert
- [ ] Multi-Projekt-Support

### Team-Interaktionsmodus

```bash
# Aufgabe ans ganze Team delegieren
aios team "Implementiere Feature X basierend auf REQ-042"

# Status checken
aios status
# Output:
# ┌────────────────────────────────────────────────┐
# │ Task: Feature X (REQ-042)                      │
# ├──────────────┬─────────┬───────────────────────┤
# │ Agent        │ Status  │ Ergebnis              │
# ├──────────────┼─────────┼───────────────────────┤
# │ Architect    │ ✅ Done  │ Design doc erstellt   │
# │ Developer    │ 🔄 WIP  │ 3/5 Module fertig     │
# │ Tester       │ ⏳ Wait │ Wartet auf Code        │
# │ Reviewer     │ ⏳ Wait │ Wartet auf Code        │
# │ QA Manager   │ ⏳ Wait │ Wartet auf Test+Review │
# └──────────────┴─────────┴───────────────────────┘

# Ergebnis abrufen
aios result task-042 --format=report
```

### Definition of Done Phase 5
- End-to-End Feature-Entwicklung durch virtuelles Team
- Compliance-Artefakte werden automatisch erzeugt
- Team arbeitet weitgehend autonom nach Aufgabenstellung
- Traceability-Matrix ist vollständig und auditierbar
