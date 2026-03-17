# Phasenplan

## Übersicht

Der Aufbau erfolgt inkrementell in 6 Phasen. Jede Phase liefert sofort nutzbaren Mehrwert.

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5 ──→ Phase 6
Foundation   Patterns    Personas    Workflows    Knowledge    Team/Compliance
  DONE         DONE        DONE      TEILWEISE    TEILWEISE    OFFEN
```

---

## Phase 1: Foundation – DONE

**Ziel:** CLI-Grundgerüst, Provider Abstraction, Router, Engine, Tests.

### Deliverables

- [x] Projektstruktur (src/, patterns/, docs/, personas/)
- [x] CLI Entry Point (Commander.js + chalk)
- [x] `aios.yaml` mit Provider-Konfiguration
- [x] Provider Abstraction (Claude API + Ollama)
- [x] `aios run <pattern>` mit Pipe-Input
- [x] Router (Meta-Agent: Aufgabe → JSON Execution Plan)
- [x] `aios "Natürlichsprachliche Aufgabe"` mit dynamischer Planung
- [x] `aios plan "Aufgabe"` (nur planen, nicht ausführen)
- [x] DAG Engine (parallele Ausführung)
- [x] Saga Engine (Retry/Rollback)
- [x] 35 Tests (vitest)

---

## Phase 2: Pattern Library – DONE

**Ziel:** Umfangreiche Pattern-Bibliothek, Suche, Erstellung, Parameterisierung.

### Deliverables

- [x] Pattern-Spezifikationsformat (YAML-Frontmatter + Markdown)
- [x] 32 Patterns in 7 Kategorien implementiert
- [x] Pattern-Discovery: `aios patterns list`, `aios patterns search <query>`
- [x] Pattern-Komposition über Pipes: `aios run p1 | aios run p2`
- [x] Pattern-Parameterisierung: `aios run review_code --language=python`
- [x] Custom Pattern Creator: `aios patterns create <name>`
- [x] Tool-Patterns (mmdc, render-image) – Patterns die externe Tools aufrufen
- [x] Image-Generierung via Patterns
- [ ] Pattern-Versionierung (Git-basiert)

---

## Phase 3: Personas – DONE

**Ziel:** Virtuelle Teammitglieder mit Rollen, Persona-Pattern-Trennung zur Laufzeit.

### Deliverables

- [x] Persona-Spezifikationsformat (YAML)
- [x] 8 Personas implementiert (RE, Architect, Dev, Tester, Security, Reviewer, TechWriter, QM)
- [x] PersonaRegistry (Laden, Auflisten, Auswählen)
- [x] Persona+Pattern-Separation zur Laufzeit
- [x] `aios ask <persona> "<aufgabe>"` funktioniert

---

## Phase 4: Workflows & Orchestrierung – TEILWEISE

**Ziel:** Definierte Workflows, EIP-Patterns, parallele Ausführung, Saga-Support.

### Erledigt

- [x] DAG-Ausführung (parallele Steps mit Abhängigkeiten)
- [x] Scatter-Gather für parallele Agent-Ausführung
- [x] Retry bei Fehlern mit Escalation
- [x] Saga-Pattern mit Rollback/Compensation

### Offen

- [ ] Workflow-Definition-Format (YAML-basiert)
- [ ] `aios workflow run <name>` startet definierten Workflow
- [ ] `aios compose` für interaktive Workflow-Erstellung
- [ ] Pub/Sub Message Bus (Topic-basierte Kommunikation)
- [ ] Status-Tracking: `aios status` zeigt laufende Workflows
- [ ] Workflow-Visualisierung (Mermaid-Output)

---

## Phase 5: Knowledge Base – TEILWEISE

**Ziel:** Geteiltes Wissen, Kontextmanagement, automatische Extraktion.

### Erledigt

- [x] Knowledge Base Grundstruktur (better-sqlite3)
- [x] CRUD-Operationen (Erstellen, Lesen, Aktualisieren, Löschen)
- [x] Textsuche über gespeichertes Wissen
- [x] Statistiken (`aios knowledge stats`)

### Offen

- [ ] Automatischer Knowledge-Import aus Agent-Outputs (Extractor)
- [ ] Kontext-Injection: Relevantes Wissen wird automatisch zum Prompt hinzugefügt
- [ ] Vektor-Suche (Embedding-basiert)
- [ ] Persona-Memory: Agenten erinnern sich an projektspezifische Entscheidungen
- [ ] Cross-Agent-Wissenstransfer

---

## Phase 6: Compliance & Team Operations – OFFEN

**Ziel:** Vollwertiges virtuelles Entwicklungsteam für regulierte Umgebungen.

### Deliverables

- [ ] Requirements-to-Test-Traceability-Workflow
- [ ] Automatische Test-Report-Generierung
- [ ] Requirements-Coverage-Matrix
- [ ] Review-Protokolle mit Audit-Trail
- [ ] Quality Gates (automatische Prüfung vor Freigabe)
- [ ] Compliance Reports (IEC 62443, ISO 27001 etc.)
- [ ] `aios team "Aufgabe"` – Aufgabe ans ganze Team delegieren
- [ ] Team-Dashboard (CLI-basiert, `aios status`)
- [ ] Integration mit externen Tools (Git, Jira-Export, Azure DevOps-Export)
- [ ] Multi-Projekt-Support
