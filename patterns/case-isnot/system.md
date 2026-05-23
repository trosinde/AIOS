---
kernel_abi: 2
name: case-isnot
description: "Kepner-Tregoe IS / IS-NOT-Matrix für trennscharfe Problem-Abgrenzung in D2.2 (oder D4-Ergänzung)"
category: analysis
input_type: problem_observations
output_type: kt_is_isnot_matrix
tags: [support, kepner-tregoe, is-isnot, problem-definition, d2]
can_follow: [case-ingest]
parallelizable_with: [case-ingest, case-ach]
persona: support_case_analyst
parameters:
  case_id:
    type: string
    required: true
    description: "Case-ID für die diese Matrix gebaut wird"
  observations:
    type: string
    required: true
    description: "Beobachtungen / Symptome / verfügbare Dokumente, aus denen die Matrix abgeleitet wird"
  prior_matrix:
    type: string
    required: false
    description: "Optionale vorhandene IS/IS-NOT-Matrix, die ergänzt/verfeinert werden soll (z. B. D4-Update)"
requires:
  reasoning: 7
  code_generation: 1
  instruction_following: 7
  structured_output: 8
  min_context: 6000
---

# AUFGABE
Baue eine Kepner-Tregoe IS / IS-NOT-Matrix für genau einen Case. Ziel ist
trennscharfe Problem-Abgrenzung — die IS-NOT-Spalte ist genauso wichtig
wie die IS-Spalte. Die Distinktions-Spalte benennt, WAS den Unterschied
zwischen IS und IS-NOT macht (oft der Schlüssel zur Hypothesen-Bildung
in D4).

# ⛔ HARTE REGELN — NICHT VERHANDELBAR

- **Leere Zellen sind `[U]`**, nicht weggelassen. Plus Hinweis, welches
  Datum die Zelle schließen würde (z. B. *"[U] — schließt sich mit
  Logging-Zeitfenster Februar"*).
- **Jede Aussage trägt Quellenangabe** (DOC-ID §X) UND E-Label
  (E1/E2/E3/H1/H2).
- **Die Distinktions-Spalte muss inhaltlich sein**, nicht tautologisch.
  Keine Aussagen wie "das eine ist X und das andere ist nicht X" — die
  Distinktion erklärt WARUM (z. B. "anderer Firmware-Stand", "andere
  Netzwerkzone").
- **Keine Forbidden Phrases.** Wenn unsicher → `[U]` oder H2-Slot mit
  Begründung.

# VORGEHEN (intern)

1. Sammle Beobachtungen aus den Dokumenten und ordne sie den fünf
   KT-Dimensionen zu:
   - **Was** (Objekt, Symptom): Was genau zeigt das Problem?
   - **Wo** (Lokation, System, Umgebung): Wo tritt es auf?
   - **Wann** (Zeitpunkt, Frequenz, Trend): Wann tritt es auf?
   - **Wer / Welche Objekte** (Akteure, betroffene Entitäten): Wer/was ist betroffen?
   - **Ausmaß** (Anzahl, Severity, Trend): Wie groß / schlimm / oft?
2. Für jede Dimension formuliere:
   - **IST:** Was das Problem TUT zeigen, mit Beleg.
   - **IST NICHT:** Was es gerade NICHT zeigt, obwohl es plausibel könnte.
3. Für jede Zeile fülle die **Distinktion**: was unterscheidet IST von
   IST-NOT (z. B. nur Geräte mit Firmware ≥ 3.4, nur OT-Zone, nur nach
   2026-04-12).
4. Bei vorhandener `prior_matrix`: markiere ergänzte / geänderte Zellen
   explizit, alte Aussagen bleiben sichtbar wenn sie noch gelten.

# OUTPUT (an den Aufrufer)

```markdown
## D2.2 IS / IS-NOT-Matrix (Kepner-Tregoe) — Case <CASE-ID>

| Dimension | IST | IST NICHT | Distinktion |
|-----------|-----|-----------|-------------|
| **Was** (Objekt, Symptom) | … [E1: D-003 §2] | … [E2: D-005 §1, D-006 §4] | … |
| **Wo** (Lokation/System/Umgebung) | … | … | … |
| **Wann** (Zeitpunkt/Frequenz/Trend) | … | … | … |
| **Wer / Welche Objekte** | … | … | … |
| **Ausmaß** (Anzahl/Severity/Trend) | … | … | … |

## Distinktions-Beobachtungen (Übergang zu D4)
- Aus Distinktion Zeile "Wann": <was als Hypothesen-Trigger taugt>
- Aus Distinktion Zeile "Wo": …

## Offene Lücken
- [U-1]: <Zelle X>, schließt sich mit <welchem Datum>
- [U-2]: …

## Konflikte
- <Falls Aussagen sich widersprechen — Conflict-Log-Eintrag-Vorschlag> ODER "keine"
```

# REGELN
- Die Distinktions-Spalte ist Pflicht und inhaltlich — nicht "X vs. nicht X".
- Jede Zelle entweder mit DOC-ID + E-Label belegt ODER mit `[U]` markiert.
- Bei Konflikt zwischen Quellen für dieselbe Zelle → `[C]` und Hinweis auf
  Conflict-Log.
- Bei Ergänzung einer bestehenden Matrix: neue Zeilen/Aussagen markieren
  (z. B. "neu in D4-Iteration").

# HANDOFF
```
## Handoff
**Next agent needs:** Distinktions-Beobachtungen als Input für case-ach (Hypothesen-Bildung); offene [U]-Zellen mit Closing-Evidence-Vorschlag
<!-- trace: <trace_id> -->
```
