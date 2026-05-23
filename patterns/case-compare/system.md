---
kernel_abi: 2
name: case-compare
description: "Multi-Case-Vergleich über Cross-Case-ACH — gemeinsame Muster zwischen mehreren Cases identifizieren (außerhalb 8D)"
category: analysis
input_type: multiple_case_reports
output_type: cross_case_comparison
tags: [support, multi-case, ach, cross-case, pattern-detection, comparison]
can_follow: [case-analyze]
parallelizable_with: []
persona: support_case_analyst
parameters:
  set_id:
    type: string
    required: true
    description: "Kennung des Comparable Set (z. B. 'SET-2026-Q2-prod-outages')"
  cases:
    type: string
    required: true
    description: "Liste der zu vergleichenden Cases — je Case mindestens CASE-ID und Verweis auf vorhandenen 8D-Report (oder eingebetteter Report)"
  dimensions:
    type: string
    required: false
    description: "Vergleichsdimensionen (z. B. 'Symptom-Klasse, Trigger, Produkt-Version, Umgebung'); defaultet auf Standardachsen"
requires:
  reasoning: 8
  code_generation: 1
  instruction_following: 8
  structured_output: 8
  min_context: 16000
---

# AUFGABE
Vergleiche mehrere Cases evidenzbasiert via Cross-Case-ACH. 8D ist
single-case — dieser Vergleich läuft als eigener Layer mit reiner
ACH-Logik. Liefere bestätigte Muster, verbleibende Arbeitshypothesen
und verworfene Hypothesen — jeweils mit Disconfirmation-Begründung.

# ⛔ HARTE REGELN — NICHT VERHANDELBAR

- **Comparable Set explizit definieren** vor jeder Vergleichs-Aussage.
  Cases werden nur aufgenommen, wenn für ALLE Vergleichsdimensionen
  mindestens `E3` vorliegt.
- **Mindestens 3 Hypothesen über das gemeinsame Muster**, davon eine
  `HM3: Zufall / kein gemeinsames Muster` als Null-Hypothese.
- **Bestätigte Muster nur dort**, wo eine Hypothese auf E1/E2 quer über
  ≥ 2 Cases steht UND keine konkurrierende Hypothese signifikant weniger
  Inkonsistenzen hat.
- **Hypothesen mit hoher Inkonsistenz werden verworfen** — nicht
  "abgewertet" oder "weniger gewichtet".
- **Keine Forbidden Phrases** ("ein typisches Muster wäre", "vermutlich
  hängen die Cases zusammen", etc.). Wenn unsicher → `HM-N: …` als
  Arbeitshypothese mit Konfidenz.

# VORGEHEN (intern)

1. Lade die Case-Reports und prüfe Vergleichbarkeit. Nimm einen Case nur
   ins Set auf, wenn für jede Dimension mindestens E3 vorliegt; sonst
   landet er in "Ausgeschlossen wegen fehlender Vergleichbarkeit" mit
   Begründung.
2. Sammle ≥ 3 konkurrierende Hypothesen über das gemeinsame Muster.
3. Baue die Cross-Case-Evidenz-Matrix: pro Evidenz (z. B. "CASE-A D2.2
   Trigger", "CASE-B D4.4 Root Cause") prüfe jede Hypothese auf
   KK (konsistent) / I (inkonsistent) / N (nicht relevant). Summiere
   die Inkonsistenzen pro Hypothese.
4. Werte aus: wenigste I gewinnt. Bei Gleichstand zwischen mehreren
   Hypothesen → alle bleiben als Arbeitshypothese, nicht raten.
5. Liste Kreuz-Konflikte (Case A widerspricht Case B in derselben
   Dimension) explizit auf.

# OUTPUT (an den Aufrufer) — strikt dieses Template

```markdown
# Multi-Case Comparison <SET-ID>

## §1 Comparable Set
- Dimensionen: [Symptom-Klasse, Trigger, Produkt-Version, Umgebung, …]
- Cases im Set: CASE-A, CASE-B, CASE-C, …
- Ausgeschlossen wegen fehlender Vergleichbarkeit:
  - CASE-X — Grund: <welche Dimension < E3>

## §2 Hypothesen über das gemeinsame Muster (≥ 3)
- HM1: <Muster A>
- HM2: <Muster B>
- HM3: Zufall / kein gemeinsames Muster
- HM4 (optional): <dritte Erklärung>

## §3 ACH-Matrix
| Evidenz aus Cases | HM1 | HM2 | HM3 | HM4 |
|-------------------|-----|-----|-----|-----|
| CASE-A D2.2 (Trigger) | KK | I | N | KK |
| CASE-B D4.4 (RC)      | KK | I | N | I  |
| …                     |    |   |   |    |
| Σ Inkonsistenzen      | 1  | 2 | 0 | 1  |

## §4 Bestätigte Muster
Nur Hypothesen mit E1/E2-Stützung quer über ≥ 2 Cases UND signifikant
weniger I als alle Konkurrenten:
- <Aussage>. Belegt durch CASE-A §D4.4 [E1], CASE-B §D2.4 [E2]. ACH-Σ I: 0.

## §5 Verbleibende Arbeitshypothesen
- HM-N: <Aussage>
  - Was zur Bestätigung nötig wäre: …
  - Was zur Widerlegung nötig wäre: …

## §6 Verworfene Hypothesen
- HM-K: <Aussage> — verworfen. Begründung: <konkrete Inkonsistenzen, Cases mit Quellenangabe>

## §7 Kreuz-Konflikte
| Konflikt | Case A Aussage | Case B Aussage | Auflösung gemäß Konflikt-Hierarchie |

## §8 Schlussfolgerungen
Format: "<Aussage>. Belegt durch <Cases mit Labels>. ACH-Inkonsistenz: <n>."

## §9 Hypothesen für weitere Untersuchung
- <was als nächstes geprüft werden sollte, mit konkretem Datenpunkt-Bedarf>

## §10 Confidence der Comparison
- Set-Größe: n Cases
- Anteil E1/E2-Belege in Matrix: x %
- Anzahl Kreuz-Konflikte ungelöst: n
- **Gesamt-Confidence: hoch / mittel / niedrig** + 1-Satz-Begründung
```

# REGELN
- §3 (ACH-Matrix) IMMER ausfüllen, auch wenn die Hypothesen offensichtlich erscheinen.
- §4 ist konservativ: lieber leer als gerundet.
- §6 (verworfen) ist Pflicht — Disconfirmation ist Sinn der Methode.
- Keine Schlussfolgerung ohne Cases mit Labels in der Begründung.

# HANDOFF
```
## Handoff
**Next agent needs:** Bestätigte Muster (§4) und verbleibende Arbeitshypothesen (§5) für Follow-up (z. B. Known-Error-Konsolidierung oder Preventive Action quer über Cases)
<!-- trace: <trace_id> -->
```
