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
type: llm                          # llm (Standard) oder tool
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

### Tool-Pattern Felder

Patterns mit `type: tool` rufen kein LLM auf, sondern führen ein CLI-Tool aus. Zusätzliche Felder:

| Feld | Beschreibung | Beispiel |
|------|-------------|---------|
| `type` | Muss `tool` sein | `tool` |
| `tool` | Name des CLI-Tools | `mmdc`, `render-image` |
| `tool_args` | Argumente als Array. `$INPUT`/`$OUTPUT` werden ersetzt | `["-i", "$INPUT", "-o", "$OUTPUT"]` |
| `input_format` | Erwartetes Dateiformat des Inputs | `mmd`, `txt` |
| `output_format` | Mögliche Ausgabeformate | `[svg, png, pdf]` |
| `can_follow` | Patterns, deren Output als Input dient | `[generate_diagram]` |

```markdown
---
name: render_diagram
type: tool
tool: mmdc
tool_args: ["-i", "$INPUT", "-o", "$OUTPUT", "-t", "dark", "-b", "transparent"]
input_format: mmd
output_format: [svg, png, pdf]
can_follow: [generate_diagram]
---
```

### CLI-Nutzung

```bash
# Einfacher Aufruf
cat spec.md | aios run extract_requirements

# Mit Parametern
cat spec.md | aios run extract_requirements --standard=iec62443 --detail_level=high

# In einer Pipe
cat spec.md | aios run extract_requirements | aios run identify_risks
```

---

## Pattern-Katalog

### Kategorie: Analyze

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `extract_requirements` | Requirements aus Text extrahieren | Freitext, Specs | Strukturierte Requirements |
| `gap_analysis` | Lücken zwischen Ist- und Soll-Zustand identifizieren | Dokument + Referenz | Gap-Report |
| `identify_risks` | Risiken identifizieren und bewerten | Anforderungen, Design | Risk Register |
| `threat_model` | STRIDE Threat Model erstellen | Design Docs | Threat Model |

### Kategorie: Generate

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `design_solution` | Technisches Design aus Requirements erstellen | Requirements | Design-Spezifikation |
| `generate_adr` | Architecture Decision Record erstellen | Entscheidungskontext | ADR (Markdown) |
| `generate_code` | Code basierend auf Spezifikation | Design Doc, Interface Spec | Source Code |
| `generate_diagram` | Mermaid-Diagramm-Code erzeugen | Beschreibung, Design Doc | Mermaid-Code |
| `generate_docs` | Technische Dokumentation erstellen | Code, Design | Technische Docs |
| `generate_image_prompt` | Bildbeschreibung zu Image-Generation-Prompt optimieren | Bildbeschreibung | Detaillierter Prompt |
| `generate_tests` | Testfälle und Testcode generieren | Requirements, Code | Test Cases / Test Code |
| `write_architecture_doc` | Architektur-Dokumentation aus Code erstellen | Quellcode, Konzeptdocs | Architektur-Dokument |
| `write_user_doc` | User-Dokumentation mit Installation und Beispielen | Code, README | User-Dokumentation |

### Kategorie: Review

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `architecture_review` | Architektur-Aspekte bewerten | Design Docs, Code | Architecture Assessment |
| `code_review` | Systematisches Code Review mit kategorisierten Findings | Source Code | Review Comments |
| `requirements_review` | Requirements auf Qualität und Testbarkeit prüfen | Requirements | Review mit Verbesserungen |
| `security_review` | Security-fokussiertes Review (OWASP, IEC 62443) | Code, Config | Security Findings |
| `test_review` | Testabdeckung und Testqualität prüfen | Tests + Requirements | Coverage Analysis |

### Kategorie: Transform

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `formalize` | Informelle Notizen in formelle Dokumente umwandeln | Notizen, E-Mails | Formelles Dokument |
| `refactor` | Code nach Clean-Code-Prinzipien refactoren | Code + Ziel | Refactored Code |
| `simplify_text` | Komplexe technische Texte vereinfachen | Technischer Text | Vereinfachte Version |
| `summarize` | Prägnante Zusammenfassung erstellen | Beliebiger Text | Zusammenfassung |
| `translate_technical` | Technische Übersetzung unter Beibehaltung von Fachbegriffen | Text + Zielsprache | Übersetzter Text |

### Kategorie: Report

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `aggregate_reviews` | Mehrere Review-Ergebnisse konsolidieren | Multiple Reviews | Gesamtbericht |
| `compliance_report` | Compliance-Bericht (IEC 62443 / CRA) | Alle Artefakte | Compliance Report |
| `risk_report` | Management-tauglicher Risiko-Report | Risk Register | Management Summary |
| `test_report` | Formalen Test-Report aus Testergebnissen erstellen | Test Results | Formaler Test-Report |

### Kategorie: Meta

| Pattern | Beschreibung | Input | Output |
|---------|-------------|-------|--------|
| `_router` | Meta-Agent: Aufgaben analysieren und Execution Plans erstellen | Task Description | Execution Plan (JSON) |
| `evaluate_quality` | Qualität eines Agent-Outputs bewerten (1-10) | Agent Output | Quality Score + Feedback |
| `extract_knowledge` | Wiederverwendbares Wissen aus Agent-Outputs extrahieren | Agent Output | Knowledge Items |

### Kategorie: Tool

Tool-Patterns rufen kein LLM auf, sondern führen externe CLI-Tools aus. Sie werden typischerweise als Folgeschritt nach einem LLM-Pattern eingesetzt.

| Pattern | Beschreibung | Tool | Input | Output |
|---------|-------------|------|-------|--------|
| `render_diagram` | Mermaid-Code zu SVG/PNG rendern | `mmdc` | Mermaid-Code (.mmd) | SVG, PNG, PDF |
| `render_image` | Bild aus Text-Prompt erzeugen | `render-image` | Image-Prompt (.txt) | PNG, WebP |

---

## Pattern-Komposition

### Einfache Pipe-Kette
```bash
cat feature_request.txt \
  | aios run extract_requirements \
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
  pattern: aggregate_reviews
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
