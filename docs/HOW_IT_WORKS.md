# Wie das Pattern-System funktioniert

## Das Grundprinzip in einem Bild

```
DU tippst:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  cat meeting_notes.md | aios run summarize

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


Was WIRKLICH passiert (4 Schritte):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  SCHRITT 1: stdin lesen
  ┌─────────────────────────────────────┐
  │ cat meeting_notes.md                │
  │                                     │
  │ "Am Montag haben wir besprochen,    │
  │  dass das Release auf Q3 verschoben │
  │  wird. Peter übernimmt die API,     │
  │  Maria die Tests. Budget wurde um   │
  │  15% gekürzt..."                    │
  └──────────────────┬──────────────────┘
                     │
                     │  dieser Text wird zu → messages[].content
                     │                        mit role: "user"
                     ▼

  SCHRITT 2: system.md lesen
  ┌─────────────────────────────────────┐
  │ ~/.aios/patterns/summarize/system.md│
  │                                     │
  │ "# IDENTITY and PURPOSE             │
  │  You are an expert content          │
  │  summarizer...                      │
  │                                     │
  │  # STEPS                            │
  │  - Read the entire input...         │
  │                                     │
  │  # OUTPUT INSTRUCTIONS              │
  │  - Start with a ONE SENTENCE..."    │
  └──────────────────┬──────────────────┘
                     │
                     │  diese Datei wird zu → system prompt
                     │
                     ▼

  SCHRITT 3: API-Call bauen und absenden
  ┌─────────────────────────────────────┐
  │                                     │
  │  anthropic.messages.create({        │
  │    model: "claude-sonnet-...",      │
  │    system: <INHALT system.md>,      │
  │    messages: [{                     │
  │      role: "user",                  │
  │      content: <INHALT von stdin>    │
  │    }]                               │
  │  })                                 │
  │                                     │
  └──────────────────┬──────────────────┘
                     │
                     │  LLM antwortet
                     ▼

  SCHRITT 4: Antwort nach stdout
  ┌─────────────────────────────────────┐
  │                                     │
  │ ONE SENTENCE SUMMARY:               │
  │ Release verschoben auf Q3 mit       │
  │ Budgetkürzung und neuer Aufgaben-   │
  │ verteilung.                         │
  │                                     │
  │ KEY POINTS:                         │
  │ 1. Release: Q2 → Q3                 │
  │ 2. Peter: API, Maria: Tests         │
  │ 3. Budget: -15%                     │
  │                                     │
  │ ACTION ITEMS:                       │
  │ - Peter: API-Scope bis Freitag      │
  │ - Maria: Testplan aktualisieren     │
  │                                     │
  └─────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```


## Pipe-Verkettung: Warum stdout→stdin so mächtig ist

```
cat spec.md | aios run extract_requirements | aios run prioritize | aios run generate_tests

Was passiert:

 spec.md          CALL 1                 CALL 2                CALL 3
┌─────────┐    ┌──────────────┐      ┌──────────────┐     ┌──────────────┐
│ Langer  │    │ system.md:   │      │ system.md:   │     │ system.md:   │
│ Freitext│───▶│ "Extract     │─────▶│ "Prioritize  │────▶│ "Generate    │──▶ Testfälle
│ mit     │    │ requirements │      │ these reqs   │     │ test cases   │
│ Anforde-│    │ from input"  │      │ by risk and  │     │ for these    │
│ rungen  │    │              │      │ business     │     │ requirements"│
│ drin    │    │ Output:      │      │ value"       │     │              │
│         │    │ REQ-001...   │      │              │     │ Output:      │
│         │    │ REQ-002...   │      │ Output:      │     │ TEST-001...  │
└─────────┘    └──────────────┘      │ 1. REQ-003   │     │ TEST-002...  │
                                     │ 2. REQ-001   │     └──────────────┘
                                     │ 3. REQ-002   │
                                     └──────────────┘

Jeder Pfeil = stdout des einen → stdin des nächsten
Jeder Kasten = eigenständiger LLM-Call mit eigener system.md
```


## Die Anatomie einer system.md

```markdown
# IDENTITY and PURPOSE          ← WER ist der Agent?
                                  (Rolle, Expertise, Kontext)

# STEPS                         ← WAS soll er tun?
                                  (Schritt-für-Schritt Anleitung)

# OUTPUT INSTRUCTIONS            ← WIE soll der Output aussehen?
                                  (Format, Struktur, Constraints)

# INPUT                         ← Marker wo der User-Input kommt
                                  (Fabric-Konvention, optional)
```

Das ist Daniel Miessler's Pattern-Struktur. Sie ist nicht technisch
erzwungen – es ist eine Konvention die gut funktioniert, weil sie
das LLM klar instruiert.

Du kannst eigene Konventionen nutzen. Zum Beispiel:

```markdown
# ROLLE
Du bist ein Requirements Engineer...

# KONTEXT
Reguliertes Umfeld, IEC 62443...

# AUFGABE
Analysiere den Input und extrahiere...

# AUSGABEFORMAT
| REQ-ID | Typ | Beschreibung | ... |

# QUALITÄTSKRITERIEN
- Jedes Requirement muss testbar sein
- Sicherheitsaspekte explizit markieren

# EINGABE
```


## Von Pattern zu Persona: Der nächste Schritt

Ein Pattern ist stateless – es weiß nichts über vorherige Aufrufe.
Eine Persona erweitert das Pattern um:

```
PATTERN (Fabric-Style)          PERSONA (AIOS-Erweiterung)
─────────────────────           ──────────────────────────
system.md                       system.md (Rolle + Expertise)
                                + context.md (Projektkontext)
                                + memory/ (vorherige Ergebnisse)
                                + tools/ (verfügbare Patterns)

API-Call:                        API-Call:
  system: <system.md>              system: <system.md>
  user: <stdin>                           + <relevanter Kontext>
                                          + <letzte Entscheidungen>
                                   user: <stdin>
```

Der fundamentale Mechanismus bleibt IDENTISCH:
  Markdown-Text → system prompt → LLM → Output

Nur der system prompt wird REICHER, weil Kontext dazukommt.
