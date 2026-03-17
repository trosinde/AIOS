# Dynamische Workflow-Orchestrierung

## Die zentrale Idee

Der User tippt EINE natürlichsprachliche Aufgabe. Das System entscheidet
selbst: welche Patterns, welche Personas, welche Topologie (sequentiell,
parallel, DAG, Saga).

```
USER:
  "Implementiere eine OAuth2-Authentifizierung für unsere REST API.
   Security ist kritisch, wir brauchen IEC 62443 Compliance."

                          │
                          ▼

                 ┌─────────────────┐
                 │   META-AGENT     │
                 │   (der Router)   │
                 │                  │
                 │ Analysiert:      │
                 │ • Was ist die    │
                 │   Aufgabe?       │
                 │ • Welche Tools   │
                 │   gibt es?       │
                 │ • Wie komplex?   │
                 │ • Was parallel?  │
                 │ • Compliance?    │
                 └────────┬────────┘
                          │
                          ▼ erzeugt

          ┌──────────────────────────────────┐
          │  EXECUTION PLAN (JSON)            │
          │                                   │
          │  steps:                           │
          │    1. extract_requirements        │
          │    2. design_solution             │
          │    3. PARALLEL:                   │
          │       - generate_code             │
          │       - threat_model              │
          │    4. PARALLEL:                   │
          │       - generate_tests            │
          │       - security_review           │
          │       - code_review               │
          │    5. compliance_report           │
          └──────────────┬───────────────────┘
                         │
                         ▼

               ┌──────────────────┐
               │  WORKFLOW ENGINE  │
               │                   │
               │  Führt den Plan   │
               │  aus (DAG-Runner  │
               │  von vorhin)      │
               └──────────────────┘
```

Der META-AGENT ist selbst ein LLM-Call mit einer system.md!
Er bekommt als Input:
  1. Die Aufgabe des Users
  2. Den KATALOG aller verfügbaren Tools/Patterns
  3. Regeln für die Planerstellung


## Die drei Schichten

```
┌──────────────────────────────────────────────────────┐
│  SCHICHT 1: Pattern Registry (passiv, deklarativ)    │
│                                                       │
│  Markdown-Dateien mit YAML-Frontmatter die            │
│  beschreiben WAS ein Pattern kann, nicht WIE           │
│  es orchestriert wird.                                │
│                                                       │
│  "Ich bin das code_review Pattern.                    │
│   Ich brauche Code als Input.                         │
│   Ich liefere Review-Findings als Output."            │
├──────────────────────────────────────────────────────┤
│  SCHICHT 2: Meta-Agent / Planner (intelligent)       │
│                                                       │
│  Ein LLM-Call der den Pattern-Katalog kennt           │
│  und daraus einen Execution Plan baut.                │
│                                                       │
│  "Für diese Aufgabe brauche ich Patterns              │
│   A, B, C. B und C können parallel laufen.            │
│   C braucht den Output von A."                        │
├──────────────────────────────────────────────────────┤
│  SCHICHT 3: Workflow Engine (mechanisch)             │
│                                                       │
│  Nimmt den Plan und führt ihn aus.                    │
│  Kennt keine AI – nur DAG-Ausführung,                 │
│  Promise.all, Retry-Logik.                            │
│                                                       │
│  "Step 3 hat Dependencies [1,2] erfüllt →             │
│   starte Step 3 und 4 parallel."                      │
└──────────────────────────────────────────────────────┘
```


## Schicht 1: Pattern Registry – Wie Patterns sich selbst beschreiben

Jedes Pattern ist weiterhin eine Markdown-Datei – aber mit einem
YAML-Frontmatter-Block der die METADATA enthält:

```
~/.aios/patterns/
├── code_review/
│   └── system.md          ← Prompt + Metadaten
├── security_review/
│   └── system.md
├── extract_requirements/
│   └── system.md
├── generate_code/
│   └── system.md
└── _router/
    └── system.md          ← Der Meta-Agent (auch ein Pattern!)
```

### Aufbau einer system.md MIT Metadaten:

```markdown
---
name: code_review
description: "Führt ein systematisches Code Review durch und gibt kategorisierte Findings zurück."
category: review
input_type: code
output_type: findings
tags: [review, quality, security, clean-code]
needs_context: [requirements, design]     # ← Optional: profitiert von diesem Kontext
can_follow: [generate_code, refactor]     # ← Typische Vorgänger
can_precede: [compliance_report, fix_code] # ← Typische Nachfolger
parallelizable_with: [security_review, architecture_review]  # ← Kann parallel laufen mit
estimated_tokens: 3000
preferred_provider: claude
persona: reviewer                          # ← Welche Persona es ausführt
---

# IDENTITY and PURPOSE

Du bist ein Senior Code Reviewer...

# STEPS
...

# OUTPUT INSTRUCTIONS
...
```

### Was der Meta-Agent daraus sieht:

Der Meta-Agent bekommt NICHT die vollen system.md Dateien.
Er bekommt nur den KATALOG – eine kompakte Zusammenfassung
aller verfügbaren Patterns:

```
VERFÜGBARE PATTERNS:

1. extract_requirements
   Beschreibung: Extrahiert strukturierte Requirements aus natürlichsprachlichem Input
   Input: freitext | Gibt: requirements
   Tags: analysis, requirements, regulated
   Kann parallel mit: gap_analysis

2. design_solution
   Beschreibung: Erstellt ein technisches Design basierend auf Requirements
   Input: requirements | Gibt: design
   Tags: architecture, design
   Braucht Kontext von: requirements
   Folgt typisch auf: extract_requirements

3. generate_code
   Beschreibung: Generiert Code basierend auf Design-Spezifikation
   Input: design | Gibt: code
   Persona: developer
   Folgt typisch auf: design_solution

4. generate_tests
   Beschreibung: Erstellt Testfälle und Testcode
   Input: code + requirements | Gibt: tests
   Persona: tester
   Kann parallel mit: security_review, code_review

5. code_review
   Beschreibung: Systematisches Code Review mit kategorisierten Findings
   Input: code | Gibt: findings
   Persona: reviewer
   Kann parallel mit: security_review, architecture_review

6. security_review
   Beschreibung: Security-fokussiertes Review
   Input: code + design | Gibt: security_findings
   Persona: security_expert
   Kann parallel mit: code_review

7. threat_model
   Beschreibung: STRIDE Threat Model erstellen
   Input: design | Gibt: threat_analysis
   Persona: security_expert
   Kann parallel mit: generate_code, generate_tests

8. compliance_report
   Beschreibung: Compliance-Bericht generieren
   Input: alle_artefakte | Gibt: report
   Persona: quality_manager
   Braucht Kontext von: requirements, tests, reviews, security
   Folgt typisch auf: code_review, security_review, generate_tests

... (weitere Patterns)
```


## Schicht 2: Der Meta-Agent (Planner)

Der Planner ist SELBST ein Pattern – eine system.md Datei!

```
~/.aios/patterns/_router/system.md
```

### Die system.md des Routers:

```markdown
---
name: _router
description: "Meta-Agent der Aufgaben analysiert und Execution Plans erstellt"
category: meta
internal: true
---

# IDENTITY and PURPOSE

Du bist der AIOS Workflow Planner. Deine Aufgabe ist es,
eine natürlichsprachliche Aufgabe zu analysieren und einen
optimalen Execution Plan zu erstellen.

# WHAT YOU RECEIVE

1. Eine AUFGABE vom User
2. Einen KATALOG aller verfügbaren Patterns (mit Metadaten)
3. Optional: PROJEKTKONTEXT (aktive Requirements, Entscheidungen, etc.)

# STEPS

1. ANALYSE der Aufgabe:
   - Was ist das Kernziel?
   - Welche Disziplinen sind beteiligt? (Code, Test, Security, Design, ...)
   - Ist Compliance relevant?
   - Wie komplex ist die Aufgabe?

2. PATTERN-AUSWAHL:
   - Welche Patterns aus dem Katalog werden benötigt?
   - Welche NICHT? (Minimalismus – nur was nötig ist)

3. ABHÄNGIGKEITEN bestimmen:
   - Welcher Schritt braucht den Output welches anderen Schritts?
   - Nutze die "needs_context", "can_follow", "can_precede" Hinweise
   - ABER: Entscheide eigenständig basierend auf der konkreten Aufgabe

4. PARALLELISIERUNG identifizieren:
   - Welche Schritte sind unabhängig voneinander?
   - Nutze die "parallelizable_with" Hinweise
   - Gruppiere unabhängige Schritte in parallele Phasen

5. FEHLERBEHANDLUNG planen:
   - Welche Schritte sind kritisch? (brauchen Quality Gate)
   - Was passiert bei Fehlern? (Retry? Eskalation?)
   - Bei regulierten Aufgaben: Saga-Pattern mit Rollback

6. INPUT-MAPPING definieren:
   - Für jeden Schritt: Welche vorherigen Ergebnisse fließen ein?

# OUTPUT FORMAT

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:

{
  "analysis": {
    "goal": "Kurzbeschreibung des Ziels",
    "complexity": "low | medium | high",
    "requires_compliance": true/false,
    "disciplines": ["development", "security", "testing", ...]
  },
  "plan": {
    "type": "pipe | scatter_gather | dag | saga",
    "steps": [
      {
        "id": "step_1",
        "pattern": "pattern_name",
        "persona": "persona_id",
        "depends_on": [],
        "input_from": ["$USER_INPUT"],
        "parallel_group": null,
        "retry": { "max": 0, "on_failure": null }
      },
      {
        "id": "step_2",
        "pattern": "design_solution",
        "persona": "architect",
        "depends_on": ["step_1"],
        "input_from": ["step_1"],
        "parallel_group": null,
        "quality_gate": {
          "pattern": "evaluate_quality",
          "min_score": 7
        }
      },
      {
        "id": "step_3a",
        "pattern": "generate_code",
        "persona": "developer",
        "depends_on": ["step_2"],
        "input_from": ["step_2"],
        "parallel_group": "implementation"
      },
      {
        "id": "step_3b",
        "pattern": "threat_model",
        "persona": "security_expert",
        "depends_on": ["step_2"],
        "input_from": ["step_2"],
        "parallel_group": "implementation"
      }
    ]
  },
  "reasoning": "Kurze Begründung warum dieser Plan optimal ist"
}

# REGELN

- Wähle den EINFACHSTEN Plan der die Aufgabe erfüllt
- Eine simple Frage braucht KEIN Scatter-Gather – ein einzelnes Pattern reicht
- Parallelisiere NUR was wirklich unabhängig ist
- Bei Compliance-Anforderungen: IMMER compliance_report als letzten Schritt
- Bei Security-relevanten Aufgaben: IMMER security_review einplanen
- Nutze Quality Gates nur für kritische Schritte (Design, Compliance)
- Der Plan muss AUSFÜHRBAR sein – keine zirkulären Abhängigkeiten!

# INPUT
```

### Was passiert bei einem CLI-Aufruf:

```bash
aios "Implementiere eine OAuth2-Authentifizierung für unsere REST API.
      Security ist kritisch, wir brauchen IEC 62443 Compliance."
```

```
SCHRITT 1: Katalog laden
═════════════════════════════════════════════════
Die CLI liest alle system.md Dateien aus ~/.aios/patterns/,
extrahiert NUR die YAML-Frontmatter-Blöcke und baut daraus
den kompakten Katalog-Text.


SCHRITT 2: Router-Call (ein ganz normaler LLM-Call!)
═════════════════════════════════════════════════

  anthropic.messages.create({
    system: <Inhalt von _router/system.md>,
    messages: [{
      role: "user",
      content: `
        ## AUFGABE
        Implementiere eine OAuth2-Authentifizierung für unsere REST API.
        Security ist kritisch, wir brauchen IEC 62443 Compliance.

        ## VERFÜGBARE PATTERNS
        1. extract_requirements – Extrahiert Requirements...
        2. design_solution – Erstellt technisches Design...
        3. generate_code – Generiert Code...
        ...

        ## PROJEKTKONTEXT
        - Tech Stack: Python/FastAPI (aus Knowledge Base)
        - Standard: IEC 62443 SL-2 (aus Projekt-Config)
        - Bestehende Auth: keine (aus Knowledge Base)
      `
    }]
  })


SCHRITT 3: Plan parsen
═════════════════════════════════════════════════
Die Antwort ist JSON → parsen → validieren → Plan-Objekt


SCHRITT 4: Plan ausführen
═════════════════════════════════════════════════
Der Plan wird an die DAG/Saga-Engine von vorhin übergeben.
Die Engine kennt keine AI – sie führt nur den Plan mechanisch aus.


SCHRITT 5: Ergebnisse sammeln
═════════════════════════════════════════════════
Alle Artefakte werden in die Knowledge Base geschrieben.
Der finale Output (z.B. compliance_report) geht nach stdout.
```


## Konkretes Beispiel: Was der Router zurückgibt

Für die OAuth2-Aufgabe würde der Router ungefähr diesen Plan erzeugen:

```json
{
  "analysis": {
    "goal": "OAuth2-Authentifizierung für REST API mit IEC 62443 Compliance",
    "complexity": "high",
    "requires_compliance": true,
    "disciplines": ["requirements", "architecture", "development", "security", "testing", "compliance"]
  },
  "plan": {
    "type": "saga",
    "steps": [
      {
        "id": "requirements",
        "pattern": "extract_requirements",
        "persona": "re",
        "depends_on": [],
        "input_from": ["$USER_INPUT"],
        "parallel_group": null
      },
      {
        "id": "design",
        "pattern": "design_solution",
        "persona": "architect",
        "depends_on": ["requirements"],
        "input_from": ["requirements", "$USER_INPUT"],
        "quality_gate": { "pattern": "architecture_review", "min_score": 7 }
      },
      {
        "id": "code",
        "pattern": "generate_code",
        "persona": "developer",
        "depends_on": ["design"],
        "input_from": ["design", "requirements"],
        "parallel_group": "impl",
        "retry": { "max": 2, "on_failure": "retry_with_feedback" }
      },
      {
        "id": "threat",
        "pattern": "threat_model",
        "persona": "security_expert",
        "depends_on": ["design"],
        "input_from": ["design"],
        "parallel_group": "impl"
      },
      {
        "id": "tests",
        "pattern": "generate_tests",
        "persona": "tester",
        "depends_on": ["code", "requirements"],
        "input_from": ["code", "requirements"],
        "parallel_group": "review"
      },
      {
        "id": "sec_review",
        "pattern": "security_review",
        "persona": "security_expert",
        "depends_on": ["code", "threat"],
        "input_from": ["code", "threat"],
        "parallel_group": "review"
      },
      {
        "id": "code_review",
        "pattern": "code_review",
        "persona": "reviewer",
        "depends_on": ["code"],
        "input_from": ["code", "design"],
        "parallel_group": "review",
        "retry": { "max": 1, "on_failure": "escalate", "escalate_to": "code" }
      },
      {
        "id": "report",
        "pattern": "compliance_report",
        "persona": "quality_manager",
        "depends_on": ["requirements", "code", "tests", "sec_review", "code_review", "threat"],
        "input_from": ["requirements", "code", "tests", "sec_review", "code_review", "threat"]
      }
    ]
  },
  "reasoning": "High complexity + IEC 62443 compliance erfordert Saga-Pattern mit Quality Gate auf Design und Retry auf Code. Security Review und Threat Model sind beide nötig wegen Compliance. Code, Threat Model können parallel (Phase 'impl'). Tests, Security Review, Code Review können parallel (Phase 'review')."
}
```


## Einfache Aufgaben → Einfache Pläne

Nicht jede Aufgabe braucht einen komplexen Workflow.
Der Router erkennt das:

```bash
aios "Fasse dieses Meeting-Protokoll zusammen"
```

Der Router gibt zurück:

```json
{
  "analysis": {
    "goal": "Meeting-Protokoll zusammenfassen",
    "complexity": "low",
    "requires_compliance": false,
    "disciplines": ["summarization"]
  },
  "plan": {
    "type": "pipe",
    "steps": [
      {
        "id": "summarize",
        "pattern": "summarize",
        "depends_on": [],
        "input_from": ["$USER_INPUT"]
      }
    ]
  },
  "reasoning": "Einfache Zusammenfassung, ein Pattern reicht."
}
```

Ein einziger Schritt. Kein Overhead.


## Mittlere Komplexität → Scatter-Gather

```bash
cat code.py | aios "Review diesen Code gründlich"
```

```json
{
  "plan": {
    "type": "scatter_gather",
    "steps": [
      {
        "id": "sec", "pattern": "security_review",
        "depends_on": [], "input_from": ["$USER_INPUT"],
        "parallel_group": "reviews"
      },
      {
        "id": "quality", "pattern": "code_review",
        "depends_on": [], "input_from": ["$USER_INPUT"],
        "parallel_group": "reviews"
      },
      {
        "id": "arch", "pattern": "architecture_review",
        "depends_on": [], "input_from": ["$USER_INPUT"],
        "parallel_group": "reviews"
      },
      {
        "id": "report", "pattern": "aggregate_reviews",
        "depends_on": ["sec", "quality", "arch"],
        "input_from": ["sec", "quality", "arch"]
      }
    ]
  }
}
```


## Der Gesamtablauf nochmal als Flussdiagramm

```
┌───────────────────────────────────────────────────────────────┐
│ USER: aios "Implementiere OAuth2 mit IEC 62443 Compliance"   │
└──────────────────────────────┬────────────────────────────────┘
                               │
                ┌──────────────▼──────────────┐
                │  1. PATTERN REGISTRY LADEN   │
                │                              │
                │  Liest alle system.md Dateien │
                │  Extrahiert YAML-Frontmatter  │
                │  Baut Katalog-Text            │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │  2. KNOWLEDGE CONTEXT LADEN  │
                │                              │
                │  Holt relevantes Projekt-     │
                │  wissen aus Knowledge Base    │
                │  (Tech Stack, Standards,      │
                │   bisherige Entscheidungen)   │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │  3. ROUTER LLM-CALL          │
                │                              │
                │  system: _router/system.md   │
                │  user:   Aufgabe             │
                │        + Katalog             │
                │        + Projektkontext      │
                │                              │
                │  → Antwort: JSON Plan        │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │  4. PLAN VALIDIEREN          │
                │                              │
                │  - Keine zirkulären Deps?    │
                │  - Alle Patterns existieren? │
                │  - Input-Mapping konsistent? │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │  5. PLAN ANZEIGEN (optional) │
                │                              │
                │  User sieht den Plan und     │
                │  kann bestätigen oder ändern  │
                │                              │
                │  "Soll ich diesen Plan       │
                │   ausführen? [Y/n/edit]"     │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │  6. DAG/SAGA ENGINE          │
                │                              │
                │  Führt Plan mechanisch aus:   │
                │  - Topologische Sortierung   │
                │  - Promise.all für Parallele │
                │  - Retry/Rollback bei Fehler │
                │  - Ergebnisse in Result Store│
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │  7. KNOWLEDGE EXTRACTION     │
                │                              │
                │  Aus jedem Schritt-Ergebnis   │
                │  werden Decisions, Facts,     │
                │  Requirements extrahiert      │
                │  und gespeichert.             │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │  8. OUTPUT                   │
                │                              │
                │  Finales Ergebnis → stdout   │
                │  Artefakte → Dateisystem     │
                │  Audit-Log → SQLite          │
                └─────────────────────────────┘
```


## Wichtig: Der User behält die Kontrolle

Das System ist NICHT autonom. Es gibt drei Modi:

### Modus 1: Auto (schnell, für bekannte Aufgaben)
```bash
aios "Fasse das zusammen" < meeting.md
# → Plant und führt sofort aus (weil einfach)
```

### Modus 2: Plan & Confirm (Standard für komplexe Aufgaben)
```bash
aios "Implementiere OAuth2 mit Compliance"
# → Zeigt Plan an
# → "Soll ich diesen Plan ausführen? [Y/n/edit]"
# → User bestätigt oder passt an
```

### Modus 3: Manual Compose (volle Kontrolle)
```bash
aios compose
# → Interaktiver Modus
# → User wählt Patterns, definiert Abhängigkeiten
# → System validiert und führt aus
```

### Modus 4: Explizit (Fabric-Style, kein Router)
```bash
cat code.py | aios run code_review
# → Kein Router, direkt ein Pattern ausführen
# → Genau wie Fabric
```
