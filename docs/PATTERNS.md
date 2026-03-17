# 04 – Tool-Bibliothek & Pattern-Spezifikation

## Pattern-Format

Patterns sind wiederverwendbare Prompt-Templates (inspiriert von Fabric), die als Markdown-Dateien mit YAML-Frontmatter gespeichert werden.

### Aufbau eines Patterns

```markdown
---
name: extract_requirements
version: "1.0"
description: "Extrahiert strukturierte Requirements aus natürlichsprachlichem Input"
category: analyze
input_type: text
output_type: structured
tags: [requirements, analysis, regulated]
parameters:
  - name: standard
    type: enum
    values: [iec62443, cra, generic]
    default: generic
  - name: detail_level
    type: enum
    values: [high, medium, low]
    default: high
recommended_provider: claude
estimated_tokens: 2000
---

# IDENTITY

Du bist ein Requirements-Analyse-Experte.

# GOAL

Extrahiere strukturierte Anforderungen aus dem gegebenen Input.

# STEPS

1. Lies den Input vollständig
2. Identifiziere funktionale und nicht-funktionale Anforderungen
3. Klassifiziere nach Typ und Priorität
4. Formuliere klare Akzeptanzkriterien
5. Identifiziere Lücken und offene Fragen

# OUTPUT FORMAT

Gib das Ergebnis als Markdown-Tabelle:

| REQ-ID | Typ | Beschreibung | Akzeptanzkriterien | Priorität | Risiko |
|--------|-----|--------------|-------------------|-----------|--------|

Gefolgt von:
- Offene Fragen
- Identifizierte Lücken
- Empfehlungen

# INPUT
```

### CLI-Nutzung

```bash
# Einfacher Aufruf
cat spec.md | aios run extract_requirements

# Mit Parametern
cat spec.md | aios run extract_requirements --standard=iec62443 --detail_level=high

# In einer Pipe
cat spec.md | aios run extract_requirements | aios run classify_requirements | aios run prioritize
```

---

## Pattern-Katalog

### Kategorie: Analyze

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `extract_requirements` | Requirements aus Text extrahieren | Freitext, Specs | Strukturierte Requirements |
| `gap_analysis` | Lücken in Dokumenten identifizieren | Dokument + Referenz | Gap-Report |
| `identify_risks` | Risiken identifizieren und bewerten | Anforderungen, Design | Risk Register |
| `classify_input` | Input nach Typ klassifizieren | Beliebiger Text | Klassifikation + Routing |
| `extract_decisions` | Entscheidungen aus Texten extrahieren | Meeting Notes, E-Mails | ADR-Entwürfe |
| `dependency_analysis` | Abhängigkeiten zwischen Komponenten | Code, Design | Dependency Graph |
| `complexity_assessment` | Aufwand und Komplexität schätzen | Requirements, User Stories | Schätzung + Begründung |

### Kategorie: Generate

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `generate_code` | Code basierend auf Spezifikation | Design Doc, Interface Spec | Source Code |
| `generate_tests` | Testfälle generieren | Requirements, Code | Test Cases / Test Code |
| `generate_docs` | Dokumentation erstellen | Code, Design | Technische Docs |
| `generate_api_spec` | API-Spezifikation erstellen | Requirements | OpenAPI Spec |
| `generate_test_data` | Testdaten generieren | Schema, Constraints | Test Fixtures |
| `generate_adr` | Architecture Decision Record | Entscheidungskontext | ADR (Markdown) |
| `generate_user_story` | User Stories formulieren | High-Level Requirements | User Stories |

### Kategorie: Review

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `code_review` | Systematisches Code Review | Source Code | Review Comments |
| `security_review` | Security-fokussiertes Review | Code, Config | Security Findings |
| `architecture_review` | Architektur bewerten | Design Docs | Architecture Assessment |
| `requirements_review` | Requirements auf Qualität prüfen | Requirements | Review mit Verbesserungen |
| `test_review` | Testabdeckung und -qualität prüfen | Tests + Requirements | Coverage Analysis |
| `compliance_review` | Compliance-Check gegen Standard | Artefakte | Compliance Report |

### Kategorie: Transform

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `summarize` | Zusammenfassung erstellen | Beliebiger Text | Zusammenfassung |
| `refactor` | Code refactoren | Code + Ziel | Refactored Code |
| `translate_technical` | Technische Übersetzung | Text + Zielsprache | Übersetzter Text |
| `convert_format` | Formatkonvertierung | Input + Zielformat | Konvertierter Output |
| `simplify` | Komplex → Einfach | Technischer Text | Vereinfachte Version |
| `formalize` | Informell → Formal | Notizen, E-Mails | Formelles Dokument |

### Kategorie: Report

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `test_report` | Test-Report generieren | Test Results | Formaler Test-Report |
| `coverage_report` | Abdeckungs-Report | Traceability Data | Coverage Matrix |
| `compliance_report` | Compliance-Bericht | Alle Artefakte | Compliance Report |
| `quality_gate_report` | Quality Gate Status | Metrics | Gate Report |
| `sprint_report` | Sprint-Zusammenfassung | Task-Daten | Sprint Report |
| `risk_report` | Risiko-Report | Risk Register | Management Summary |

### Kategorie: Meta

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `route_task` | Aufgabe an richtigen Agenten routen | Task Description | Routing Decision |
| `decompose_task` | Aufgabe in Teilaufgaben zerlegen | Komplexe Aufgabe | Task-Breakdown |
| `aggregate_results` | Ergebnisse zusammenführen | Multiple Inputs | Konsolidierter Output |
| `evaluate_quality` | Output-Qualität bewerten | Agent Output | Quality Score + Feedback |
| `extract_knowledge` | Wissen aus Output extrahieren | Agent Output | Knowledge Items |

---

## Pattern-Komposition

### Einfache Pipe-Kette
```bash
cat feature_request.txt \
  | aios run extract_requirements \
  | aios run classify_requirements \
  | aios run generate_tests
```

### Benannte Komposition
```yaml
# patterns/composed/req_to_test.yaml
name: req_to_test
type: composed
description: "Von Anforderung bis Testfälle"
steps:
  - pattern: extract_requirements
  - pattern: classify_requirements
  - pattern: generate_tests
    params:
      coverage: full
```

```bash
# Nutzung
cat feature.txt | aios run req_to_test
```

### Parallele Komposition
```yaml
# patterns/composed/full_review.yaml
name: full_review
type: scatter-gather
description: "Paralleles Multi-Perspektiven-Review"
scatter:
  - pattern: code_review
  - pattern: security_review
  - pattern: architecture_review
gather:
  pattern: aggregate_results
  params:
    format: consolidated_review
```

---

## Pattern-Erstellung

```bash
# Interaktiv
aios patterns create my_pattern
# → Editor öffnet sich mit Template
# → Pattern wird validiert
# → Pattern wird registriert

# Aus bestehendem Prompt
aios patterns import --from-file my_prompt.md --name my_pattern

# Von Fabric importieren
aios patterns import --from-fabric extract_wisdom
```

## Pattern-Discovery

```bash
# Alle Patterns auflisten
aios patterns list

# Nach Kategorie filtern
aios patterns list --category=review

# Suchen
aios patterns search "security compliance"

# Details anzeigen
aios patterns info security_review

# Pattern testen
echo "test input" | aios patterns test security_review
```
