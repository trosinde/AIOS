# Was der Router sieht vs. was ausgeführt wird

## Die zwei Gesichter einer system.md

Jede Pattern-Datei hat ZWEI Rollen:

```
security_review/system.md
═══════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────┐
│  YAML FRONTMATTER (für den Router)                  │
│                                                      │
│  ---                                                 │
│  name: security_review                               │
│  description: "Security-fokussiertes Code Review"    │
│  input_type: code                                    │
│  output_type: security_findings                      │
│  parallelizable_with: [code_review, arch_review]     │
│  persona: security_expert                            │
│  ---                                                 │
│                                                      │
│  → Der ROUTER liest NUR diesen Teil                  │
│  → Er versteht: "Dieses Tool prüft Code auf         │
│    Security und kann parallel mit code_review         │
│    laufen"                                           │
│  → Er braucht den Prompt NICHT zu kennen             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  MARKDOWN PROMPT (für die Ausführung)               │
│                                                      │
│  # IDENTITY and PURPOSE                              │
│  Du bist ein Cybersecurity-Experte...                │
│                                                      │
│  # STEPS                                             │
│  1. Identifiziere die Angriffsfläche...              │
│  2. Prüfe auf OWASP Top 10...                        │
│                                                      │
│  # OUTPUT INSTRUCTIONS                               │
│  Für jedes Finding: 🔴 CRITICAL | 🟠 HIGH ...       │
│                                                      │
│  → Die ENGINE liest NUR diesen Teil                  │
│  → Er wird als system prompt an das LLM geschickt   │
│  → Der Router hat diesen Teil nie gesehen            │
└─────────────────────────────────────────────────────┘
```


## Informationsfluss im Detail

```
USER: "Review meinen Auth-Code auf Security"
  │
  │
  ▼
┌────────────────────────────────────────────────────────────┐
│ REGISTRY: Liest alle system.md Dateien                     │
│                                                             │
│ Für den ROUTER extrahiert sie NUR die Frontmatter:         │
│                                                             │
│  ┌────────────────────────────┐                             │
│  │ 1. code_review             │                             │
│  │    Input: code              │                             │
│  │    Output: findings         │  ← Kompakter              │
│  │    Parallel: security,arch  │     Katalog-Text            │
│  │                             │     (~50 Zeilen für         │
│  │ 2. security_review          │      20 Patterns)           │
│  │    Input: code              │                             │
│  │    Output: security_findings│                             │
│  │    Parallel: code,arch      │                             │
│  │                             │                             │
│  │ 3. summarize                │                             │
│  │    Input: text              │                             │
│  │    Output: summary          │                             │
│  │ ...                         │                             │
│  └────────────────────────────┘                             │
└──────────────────────┬─────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────┐
│ ROUTER (ein einziger LLM-Call):                            │
│                                                             │
│   System: "Du bist der AIOS Workflow Planner..."           │
│                                                             │
│   User:   "AUFGABE: Review meinen Auth-Code auf Security   │
│                                                             │
│            VERFÜGBARE PATTERNS:                             │
│            1. code_review – Input: code → findings          │
│               Parallel mit: security_review, arch_review    │
│            2. security_review – Input: code → sec_findings  │
│               Parallel mit: code_review, arch_review        │
│            3. architecture_review – Input: code → assessment│
│            4. aggregate_reviews – Input: findings → report  │
│            5. summarize – Input: text → summary             │
│            ..."                                             │
│                                                             │
│   Der Router DENKT:                                         │
│   "Security-Review angefragt. Für gründliches Review       │
│    sollte ich code_review und security_review parallel      │
│    laufen lassen (Metadaten sagen: parallelizable).        │
│    Dann aggregate_reviews zum Zusammenführen.               │
│    summarize ist irrelevant → nicht verwenden."            │
│                                                             │
│   Output:                                                   │
│   {                                                         │
│     "plan": {                                               │
│       "type": "scatter_gather",                             │
│       "steps": [                                            │
│         { "id": "sec",  "pattern": "security_review",       │
│           "depends_on": [], "parallel_group": "review" },   │
│         { "id": "code", "pattern": "code_review",           │
│           "depends_on": [], "parallel_group": "review" },   │
│         { "id": "agg",  "pattern": "aggregate_reviews",     │
│           "depends_on": ["sec","code"],                     │
│           "input_from": ["sec","code"] }                    │
│       ]                                                     │
│     }                                                       │
│   }                                                         │
└──────────────────────┬─────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────┐
│ ENGINE: Liest den vollen Prompt jedes Patterns             │
│                                                             │
│   Step "sec" → Öffnet security_review/system.md            │
│                IGNORIERT das Frontmatter                    │
│                NUTZT den Markdown-Prompt als system prompt  │
│                                                             │
│     API-Call:                                               │
│       system: "Du bist ein Cybersecurity-Experte..."       │
│       user:   <der Auth-Code des Users>                    │
│                                                             │
│   Step "code" → Öffnet code_review/system.md               │
│                 (gleicher Mechanismus, anderer Prompt)      │
│                                                             │
│   Step "agg" → Öffnet aggregate_reviews/system.md          │
│       user:   "Ergebnis von sec: ...\n                     │
│                Ergebnis von code: ..."                     │
│                                                             │
└────────────────────────────────────────────────────────────┘
```


## Der Schlüssel-Insight

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│  Die Patterns beschreiben sich SELBST so, dass der       │
│  Router sie als Bausteine verwenden kann – ohne ihre     │
│  internen Prompts kennen zu müssen.                      │
│                                                          │
│  Das ist wie eine Toolbox:                               │
│                                                          │
│  • Das LABEL auf dem Werkzeug sagt dir:                  │
│    "Ich bin ein Schraubendreher, Kreuzschlitz, PH2"     │
│    → Das liest der Planer (Router)                       │
│                                                          │
│  • Die FUNKTIONSWEISE des Werkzeugs (wie man es hält,    │
│    wie viel Drehmoment) kennt nur der AUSFÜHRENDE         │
│    → Das liest die Engine                                │
│                                                          │
│  Der Router sagt: "Nimm den Kreuzschlitz-Schraubendreher"│
│  Die Engine sagt: "Ok, so benutzt man ihn: ..."         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```


## Wie das Pattern-Ökosystem wächst

```
NEUES PATTERN HINZUFÜGEN:

1. mkdir ~/.aios/patterns/validate_api_contract
2. Erstelle system.md mit Frontmatter + Prompt
3. Fertig. Sofort verfügbar.

Der Router sieht beim nächsten Aufruf automatisch:
"Oh, es gibt ein neues Pattern 'validate_api_contract'.
 Input: api_spec → Output: validation_report.
 Kann nach 'design_solution' und vor 'generate_code' laufen."

Kein Code-Change nötig. Kein Deployment.
Nur eine Markdown-Datei anlegen.
```
