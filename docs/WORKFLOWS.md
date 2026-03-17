# Parallele & Synchronisierte Workflows

## Das Problem mit reinen Pipes

Pipes sind sequentiell – jeder Schritt wartet auf den vorherigen:

```
Input ──▶ Agent A ──▶ Agent B ──▶ Agent C ──▶ Output
          (30 Sek)   (30 Sek)   (30 Sek)
                                            = 90 Sekunden
```

Aber oft sind Schritte UNABHÄNGIG voneinander. Ein Code Review
braucht nicht auf das Security Review zu warten und umgekehrt:

```
          ┌──▶ Security Review (30s)  ──┐
Input ──▶ ├──▶ Code Quality (30s)     ──┼──▶ Zusammenführen ──▶ Output
          └──▶ Architecture Check (30s)─┘
                                            = 30 Sekunden + Aggregation
```

Das ist das **Scatter-Gather-Pattern** aus den Enterprise Integration Patterns.


---


## Pattern 1: Scatter-Gather (Fan-Out / Fan-In)

### Konzept

```
                    SCATTER (Fan-Out)              GATHER (Fan-In)
                    ════════════════               ═══════════════

                    ┌─────────────────┐
                    │  Security Expert │
                    │  system.md:      │
              ┌────▶│  "Prüfe auf     │────┐
              │     │   Vulnerabilities"│    │
              │     └─────────────────┘    │
              │                            │
┌──────────┐  │     ┌─────────────────┐    │     ┌──────────────┐
│          │  │     │  Code Reviewer   │    │     │              │
│  Code    │──┼────▶│  system.md:      │────┼────▶│  Aggregator  │──▶ Output
│  (stdin) │  │     │  "Prüfe Code-   │    │     │  system.md:  │
│          │  │     │   Qualität"      │    │     │  "Fasse die  │
└──────────┘  │     └─────────────────┘    │     │   Reviews    │
              │                            │     │   zusammen"  │
              │     ┌─────────────────┐    │     └──────────────┘
              │     │  Architect       │    │
              └────▶│  system.md:      │────┘
                    │  "Prüfe Archi-  │
                    │   tektur"        │
                    └─────────────────┘

              ▲                            ▲
              │                            │
          DERSELBE Input               ALLE Ergebnisse
          geht an ALLE                 werden GESAMMELT
          Agenten                      und ZUSAMMENGEFÜHRT
```

### Was passiert technisch?

```
Zeitachse:
═══════════════════════════════════════════════════════════

t=0s     Scatter: Input an alle 3 Agenten gleichzeitig senden
         │
         ├── API-Call 1: system=security.md,   user=<code>
         ├── API-Call 2: system=reviewer.md,   user=<code>
         └── API-Call 3: system=architect.md,  user=<code>
         
         (Alle 3 laufen PARALLEL via Promise.all)

t=25s    Security Expert antwortet als Erster → Ergebnis speichern
t=30s    Architect antwortet → Ergebnis speichern
t=35s    Code Reviewer antwortet als Letzter → Ergebnis speichern

         Promise.all resolved: Alle 3 Ergebnisse da.

t=35s    Gather: Alle Ergebnisse zusammenführen
         │
         └── API-Call 4: system=aggregator.md
                         user= "SECURITY REVIEW:\n" + ergebnis1
                             + "CODE REVIEW:\n"     + ergebnis2
                             + "ARCHITECTURE:\n"    + ergebnis3

t=45s    Aggregator antwortet → Finales Ergebnis nach stdout

Gesamt: ~45 Sekunden statt ~105 Sekunden sequentiell
═══════════════════════════════════════════════════════════
```


---


## Pattern 2: Scatter-Gather mit Abhängigkeiten (DAG)

Nicht immer sind alle Schritte unabhängig. Manchmal gibt es einen
**gerichteten azyklischen Graphen (DAG)** von Abhängigkeiten:

```
                    ┌─────────────┐
                    │  1. Analyze  │
                    │  Requirements│
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  2. Design   │
                    │  Solution    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────┴──────┐ ┌──┴───────┐ ┌──┴──────────┐
       │ 3a. Generate│ │ 3b. Write│ │ 3c. Threat  │
       │    Code     │ │   Tests  │ │    Model    │
       └──────┬──────┘ └──┬───────┘ └──┬──────────┘
              │            │            │
              │     ┌──────┴──────┐     │
              │     │ 4. Run Tests│     │
              │     │ (braucht    │     │
              │     │  Code + Tests)    │
              │     └──────┬──────┘     │
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────┴──────┐
                    │ 5. Final    │
                    │ Report      │
                    └─────────────┘

Legende:
  1 → 2         : sequentiell (2 braucht Output von 1)
  2 → 3a,3b,3c  : parallel (alle brauchen nur Output von 2)
  3a+3b → 4     : synchronisiert (4 braucht Code UND Tests)
  3a+3b+3c+4 → 5: synchronisiert (Report braucht alles)
```

### Was passiert?

```
t=0s     Step 1: Analyze Requirements
         → wartet auf Ergebnis

t=30s    Step 2: Design Solution (Input: Output von Step 1)
         → wartet auf Ergebnis

t=60s    Steps 3a, 3b, 3c PARALLEL starten
         ├── 3a: Generate Code   (Input: Design)
         ├── 3b: Write Tests     (Input: Design + Requirements)
         └── 3c: Threat Model    (Input: Design)

t=90s    3c fertig (Threat Model)  → gespeichert, wartet
t=95s    3a fertig (Code)          → gespeichert, prüfe: kann Step 4 starten?
                                      → Nein, 3b fehlt noch
t=100s   3b fertig (Tests)         → gespeichert, prüfe: kann Step 4 starten?
                                      → Ja! Code (3a) + Tests (3b) beide da

t=100s   Step 4: Run Tests (Input: Code + Tests)
         → wartet auf Ergebnis

t=120s   Step 4 fertig → prüfe: kann Step 5 starten?
                         → Ja! 3a + 3b + 3c + 4 alle da

t=120s   Step 5: Final Report (Input: ALLE vorherigen Outputs)

t=140s   FERTIG.

         Sequentiell wäre: 30+30+30+30+30+30+30 = 210s
         Mit DAG:          30+30+40+20+20       = 140s
```


---


## Pattern 3: Saga mit Fehlerbehandlung

Was wenn ein Schritt FEHLSCHLÄGT? In regulierten Umgebungen
kannst du nicht einfach "weiter machen".

```
HAPPY PATH:
═══════════════════════════════════════════════

  Analyze ──▶ Design ──▶ Implement ──▶ Test ──▶ Review ──▶ ✅ Done


FEHLER BEI TEST:
═══════════════════════════════════════════════

  Analyze ──▶ Design ──▶ Implement ──▶ Test ──▶ ❌ FAIL
                              ▲          │
                              │          │ Feedback: "Test X failed
                              │          │  weil Funktion Y keinen
                              │          │  Null-Check hat"
                              │          │
                              └──────────┘
                              Retry #1: Developer bekommt
                              Feedback + Original-Aufgabe

  Wenn Retry #1 auch fehlschlägt:

  Analyze ──▶ Design ──▶ Implement ──▶ Test ──▶ ❌ FAIL (retry 1)
                 ▲                       │
                 │                       │ Feedback: "Fundamentales
                 │                       │  Design-Problem erkannt"
                 │                       │
                 └───────────────────────┘
                 Eskalation: Zurück zum Architect
                 mit allen gesammelten Erkenntnissen


FEHLER BEI REVIEW (nach erfolgreichem Test):
═══════════════════════════════════════════════

  ... ──▶ Implement ──▶ Test ✅ ──▶ Review ──▶ ❌ REJECTED
              ▲                        │
              │                        │ Findings:
              │                        │  🔴 Critical: SQL Injection
              │                        │  🟠 Major: No input validation
              │                        │
              └────────────────────────┘
              Developer bekommt:
              - Original-Aufgabe
              - Review-Findings
              - Test-Ergebnisse (die immer noch gelten)
              → Muss NUR die Findings fixen
```


---


## Wie die Synchronisation funktioniert

Der Schlüssel ist ein **Result Store** – ein Zwischenspeicher
der weiß, welche Ergebnisse da sind und welche noch fehlen:

```
┌─────────────────────────────────────────────┐
│              Result Store                    │
│                                             │
│  Step        Status     Output              │
│  ─────────── ────────── ──────────────────  │
│  analyze     ✅ done    "REQ-001, REQ-002"  │
│  design      ✅ done    "API Design v1..."  │
│  gen_code    ✅ done    "function auth()..." │
│  gen_tests   🔄 running  -                  │
│  threat      ✅ done    "STRIDE analysis..." │
│  run_tests   ⏳ blocked  -                  │
│  report      ⏳ blocked  -                  │
│                                             │
│  Dependency Check:                          │
│  run_tests braucht: gen_code ✅ + gen_tests 🔄│
│  → WARTEN                                   │
│                                             │
│  report braucht: gen_code ✅ + gen_tests 🔄  │
│                + threat ✅ + run_tests ⏳     │
│  → WARTEN                                   │
└─────────────────────────────────────────────┘

... 5 Sekunden später ...

┌─────────────────────────────────────────────┐
│              Result Store                    │
│                                             │
│  gen_tests   ✅ done    "test('auth',()..." │
│  run_tests   ⏳ blocked → KANN STARTEN!     │
│                                             │
│  Dependency Check:                          │
│  run_tests braucht: gen_code ✅ + gen_tests ✅│
│  → STARTEN!                                 │
└─────────────────────────────────────────────┘
```

Das ist im Kern eine **topologische Sortierung** des DAG
kombiniert mit einem **Event-Loop** der auf Completion prüft.
