---
kernel_abi: 2
name: case-ach
description: "Analysis of Competing Hypotheses (Heuer) — Disconfirmation-getriebene Hypothesen-Bewertung in D4.2 (oder Cross-Case)"
category: analysis
input_type: hypotheses_and_evidence
output_type: ach_matrix_with_verdict
tags: [support, ach, heuer, hypothesis-competition, disconfirmation, d4]
can_follow: [case-isnot, case-ingest]
parallelizable_with: [case-isnot]
persona: support_case_analyst
parameters:
  case_id:
    type: string
    required: true
    description: "Case-ID (oder SET-ID bei Cross-Case-Anwendung)"
  hypotheses:
    type: string
    required: true
    description: "Mindestens 3 konkurrierende Hypothesen, davon eine 'Zufall / kein Muster' (Null-Hypothese)"
  evidence_pool:
    type: string
    required: true
    description: "Liste der zu prüfenden Evidenzen mit DOC-ID-Verweisen (z. B. 'E-1: D-003 §2 Log-Timestamp; E-2: D-005 §1 Kunden-Mail; ...')"
requires:
  reasoning: 8
  code_generation: 1
  instruction_following: 8
  structured_output: 8
  min_context: 8000
---

# AUFGABE
Bewerte konkurrierende Hypothesen via Analysis of Competing Hypotheses
(Heuer). Kerngedanke: nicht die Hypothese mit den meisten "passt"-Belegen
gewinnt, sondern die mit den **wenigsten Widersprüchen (Inkonsistenzen)**.
Disconfirmation statt Confirmation — das ist die Methode.

# ⛔ HARTE REGELN — NICHT VERHANDELBAR

- **Mindestens 3 Hypothesen**, davon eine **"Zufall / kein gemeinsames
  Muster"** als Null-Hypothese. Ohne Null-Hypothese ist die Matrix
  ungültig.
- **Auswertung:** wenigste **I** (Inkonsistenzen) gewinnt — NICHT meiste
  **KK** (Konsistenzen). Wer KK summiert, betreibt Confirmation Bias.
- **Hypothesen mit eindeutig hoher Inkonsistenz werden verworfen**, nicht
  "abgewertet". Verworfene Hypothesen werden im Output explizit ausgewiesen,
  inkl. Inkonsistenz-Begründung.
- **Jede Evidenz trägt DOC-ID-Verweis und E-Label** (E1/E2/E3/H1/H2).
- **Bei Gleichstand:** alle gleichplatzierten Hypothesen bleiben als
  Arbeitshypothese — nicht raten, nicht würfeln.

# VORGEHEN (intern)

1. Prüfe Eingangs-Hypothesen: ≥ 3, davon eine Null-Hypothese. Wenn nicht
   erfüllt, ergänze ⚠️ und bitte um Klärung — KEINE Matrix bauen.
2. Für jede Evidenz × jede Hypothese:
   - **KK** = Evidenz ist konsistent mit Hypothese
   - **I**  = Evidenz ist inkonsistent (widerspricht) Hypothese
   - **N**  = Evidenz ist nicht relevant für Hypothese
3. Summiere I pro Hypothese.
4. Werte aus:
   - Hypothese mit den wenigsten I gewinnt (Arbeitshypothese).
   - Hypothesen mit eindeutig hohem I werden **verworfen** — mit
     Begründung (welche Evidenzen widersprechen explizit).
   - Bei Gleichstand zwischen ≥ 2 Hypothesen: beide bleiben als
     Arbeitshypothese; Vorschlag für Closing Evidence formulieren.
5. Liste, welche Evidenz fehlt, um zwischen verbleibenden Hypothesen zu
   entscheiden ("disconfirming evidence wanted").

# OUTPUT (an den Aufrufer)

```markdown
## ACH-Matrix — Case <CASE-ID>

### Hypothesen
- H1: <Aussage>
- H2: <Aussage>
- H3: Zufall / kein gemeinsames Muster (Null-Hypothese)
- H4 (optional): <Aussage>

### Evidenz-Matrix
| Evidenz | Quelle | E-Label | H1 | H2 | H3 | H4 |
|---------|--------|---------|----|----|----|----|
| E-1: <Beschreibung> | D-003 §2 | E1 | KK | I  | N  | KK |
| E-2: <Beschreibung> | D-005 §1 | E2 | I  | KK | N  | KK |
| E-3: <Beschreibung> | D-007 §4 | E3 | I  | KK | N  | I  |
| …       |        |         |    |    |    |    |
| **Σ Inkonsistenzen** |   |   | 2  | 1  | 0  | 1  |

Legende: KK = konsistent | I = inkonsistent | N = nicht relevant

### Auswertung
- **Arbeitshypothese:** H2 (Σ I = 1) — wenigste Inkonsistenzen
- **Verworfen:** H1 (Σ I = 2) — Begründung: <konkrete inkonsistente Evidenzen>
- **Hinweis:** H3 (Null-Hypothese) hat Σ I = 0, aber nur, weil alle
  Evidenzen für sie `N` sind — das ist erwartet und KEIN Beleg für
  "Zufall". Null-Hypothese gewinnt nur, wenn alle anderen Hypothesen
  verworfen sind.

### Verbleibende Arbeitshypothesen (falls Gleichstand oder weiter offen)
- H2: <Aussage> — Σ I = 1
  - Was zur Bestätigung nötig wäre: <konkrete Evidenz, z. B. "Logging-Auszug aus Zeitfenster X">
  - Was zur Widerlegung nötig wäre: …

### Konfidenz der Auswertung
- E1/E2-Anteil in der Matrix: x %
- Σ I-Abstand zwischen Top-1 und Top-2: n (je größer, desto sicherer)
- **Konfidenz: hoch / mittel / niedrig** + 1-Satz-Begründung
```

# REGELN
- Null-Hypothese ist Pflicht.
- "Auswertung" ist explizit: niemals nur "H2 gewinnt" — immer mit Σ I.
- Verworfene Hypothesen erscheinen IMMER im Output mit Begründung.
- E1/E2-Anteil ist Teil der Konfidenz-Begründung: eine Matrix aus
  E3-Einzelquellen kann formal sauber sein, ist aber inhaltlich schwach.

# HANDOFF
```
## Handoff
**Next agent needs:** Arbeitshypothese (Σ I + E-Label-Mix) + Liste fehlender Disconfirming Evidence für Closing der verbleibenden Hypothesen
<!-- trace: <trace_id> -->
```
