---
kernel_abi: 2
name: case-analyze
description: "Single-Case 8D-Forensik: D0–D8 als Outer Frame, innen KT/Toulmin/ACH/KCS — vollständiger evidenzbasierter Case-Report"
category: orchestration
input_type: case_documents
output_type: case_8d_report
tags: [support, 8d, kepner-tregoe, toulmin, ach, kcs, forensic, case-analysis]
can_follow: [case-ingest, case-isnot, case-ach]
parallelizable_with: []
persona: support_case_analyst
parameters:
  case_id:
    type: string
    required: true
    description: "Eindeutige Case-Kennung (Ticket-ID, Incident-ID, etc.)"
  documents:
    type: string
    required: true
    description: "Verfügbare Dokumente/Quellen zum Case (Tickets, Logs, Mailverlauf, Berichte) — werden ins KCS-Ledger aufgenommen"
  case_scope:
    type: string
    required: false
    description: "Optionaler Scope-Hinweis (z. B. 'nur Production-Outage 2026-04-12', 'Hotline-Eskalation Kunde X')"
requires:
  reasoning: 8
  code_generation: 1
  instruction_following: 8
  structured_output: 9
  min_context: 16000
---

# AUFGABE
Erzeuge eine vollständige forensische 8D-Analyse für genau einen Support
Case. Outer Frame ist 8D (D0–D8); innen liefern Kepner-Tregoe (D2.2),
Toulmin (jeder Claim), ACH (D4.2 ab ≥2 Hypothesen) und KCS (Document
Ledger) die Disziplin.

# ⛔ HARTE REGELN — NICHT VERHANDELBAR

- **Kein Claim ohne Toulmin-Kette.** Wenn Warrant/Backing nicht
  ausformuliert werden können → Claim wandert in H1/H2-Slot.
- **Schlussfolgerungen in D5/D7 nur auf E1/E2.** E3/H1/H2 dürfen erwähnt,
  aber nicht als Tragwerk verwendet werden.
- **Slots ohne Inhalt bleiben mit `[U]`** — niemals weglassen, niemals
  raten, niemals mit "üblicherweise" füllen.
- **Containment ≠ Resolution.** D3 / D5–D6 / D7 sauber getrennt.
- **Mindestens 3 Hypothesen** in D4.1, davon eine "Zufall / kein Muster".
- **ACH-Auswertung:** wenigste Inkonsistenzen gewinnt, nicht meiste KK.
- Keine **Forbidden Phrases** ("vermutlich", "in der Regel", "ein typisches
  Muster wäre", "aus den Dokumenten geht hervor" ohne Referenz, etc.).

# VORGEHEN (intern)

1. Lade alle übergebenen Dokumente ins KCS Document Ledger (A1) ein.
   Für jedes Dokument: DOC-ID, Titel, Quelle, Datum, Autor, Vertrauen
   (hoch/mittel/niedrig), KCS-Qualität (A/B/C), Status.
2. Anwende den Relevanz-Filter (`case-ingest`-Logik): bei ≥ 2 Nein im
   Demand-Test → `Status: not used` mit Begründung im Ledger lassen.
3. Fülle die 8D-Sektionen Slot-für-Slot:
   - D0: Auslöser, Scope, erwartetes Deliverable, Ledger angelegt
   - D1: Quellen-Liste, externe Stakeholder, Lücken
   - D2: Symptome → KT IS/IS-NOT-Matrix (D2.2) → Bedingungen/Kontext → Toulmin pro Claim
   - D3: Sofortmaßnahmen + Wirksamkeit (verifiziert?) + Reststörung
   - D4: ≥ 3 Hypothesen → ACH-Matrix (D4.2) → 5 Whys / Fault Tree (D4.3) → bestätigte Root Cause oder offen
   - D5: ≥ 2 Optionen, Bewertungskriterien, gewählte Option mit Evidenz
   - D6: Implementierungs-Schritte, Validierungsmethode, Ergebnis
   - D7: System-Maßnahme, Bezug zu anderen Cases, Verifikation
   - D8: Status, Known-Error-Eintrag, KCS-Artikel-Kandidat, Lessons Learned
4. Bei Konflikten zwischen Quellen die Konflikt-Hierarchie anwenden
   (Primär > Sekundär · datiert > undatiert · neuer > älter · KCS-A > B > C).
   Greift keine Regel → beide `[C]` und in Conflict Log (A2).
5. Füge die Anhänge an: A1 Ledger, A2 Conflict Log, A3 Open Items, A4
   Self-Check, A5 Confidence Score.

# OUTPUT (an den Aufrufer) — strikt dieses Template

```markdown
# Case <CASE-ID> — 8D-Analyse

## D0 — Vorbereitung
- Auslöser: …
- Scope: …
- Erwartetes Deliverable: …
- Document Ledger angelegt: ja/nein (siehe A1)

## D1 — Team & Quellen
- Quellen-Liste: D-001 (Autor A), D-002 (Autor B), …
- Externe Stakeholder genannt in Dokumenten: …
- Lücken: [U-1]: <was fehlt>

## D2 — Problem Description
### D2.1 Symptom
- S1: <Beschreibung> [Typ-Markierung, E1: D-003 §2]
- S2: …

### D2.2 IS / IS-NOT-Matrix (Kepner-Tregoe)
| Dimension | IST | IST NICHT | Distinktion |
|-----------|-----|-----------|-------------|
| Was       | …   | …         | …           |
| Wo        | …   | …         | …           |
| Wann      | …   | …         | …           |
| Wer/Welche Objekte | … | …  | …           |
| Ausmaß    | …   | …         | …           |

Leere Zellen → `[U]` + welches Datum sie füllen würde.

### D2.3 Bedingungen & Kontext
- Umgebung: …
- Trigger: …
- Frequenz: …
- Reproduzierbarkeit: …

### D2.4 Belegkette (Toulmin pro Claim)
- Claim: …
- Grounds: … [E-Label, DOC-ID §X]
- Warrant: …
- Backing: …
- Qualifier: …
- Rebuttal: …

## D3 — Containment / Interim Action
- Sofortmaßnahme(n): …
- Wirksamkeit (verifiziert?): [E1/E2/nicht verifiziert]
- Reststörung trotz Containment: …

## D4 — Root Cause Analysis
### D4.1 Hypothesen-Sammlung (≥ 3, davon eine "Zufall / kein Muster")
- H1: …
- H2: …
- H3: …

### D4.2 ACH-Matrix (Pflicht ab ≥ 2 ernsthaften Hypothesen)
| Evidenz | H1 | H2 | H3 |
|---------|----|----|----|
| E-1     | KK | I  | N  |
| E-2     | I  | KK | KK |
| Σ Inkonsistenzen | 1 | 1 | 0 |

Auswertung: <wenigste I gewinnt; Hypothesen mit eindeutig hoher I verworfen>

### D4.3 Kausalkette (5 Whys oder Fault Tree)
- Why 1: … [E-Label, DOC-ID]
- Why 2: …

### D4.4 Bestätigte Root Cause
- <Bestätigt nur bei E1/E2 mit vollständiger Toulmin-Kette> ODER
- "Root Cause nicht etabliert. Stand: [H1], offene Lücke [U]: <welche Information fehlt>"

## D5 — Permanent Corrective Action: Auswahl
- Optionen (≥ 2): …
- Bewertungskriterien: …
- Gewählte Option: …
- Begründung mit Evidenz: … (nur E1/E2)

## D6 — Implementierung & Validierung
- Implementierungs-Schritte: …
- Validierungs-Methode: …
- Validierungs-Ergebnis: [E1/E2 belegt] / [noch offen] / [fehlgeschlagen]

## D7 — Preventive Action (Systemebene)
- System-Maßnahme: …
- Bezug zu anderen Cases (siehe Multi-Case falls vorhanden): …
- Verifikation: …

## D8 — Closure & Knowledge Capture
- Case-Status: geschlossen / known error / weiter offen
- Known-Error-Eintrag erzeugt: ja/nein (Verweis)
- KCS-Artikel-Kandidat: ja/nein (Inhalts-Skizze)
- Lessons Learned (nur evidenzgestützt): …

---

## A1 — Document Ledger
| DOC-ID | Titel | Quelle | Datum | Autor | Vertrauen | KCS | Status |
|--------|-------|--------|-------|-------|-----------|-----|--------|
| D-001  | …     | …      | …     | …     | hoch      | A   | aktiv  |

## A2 — Conflict Log
| Konflikt | Quelle A | Quelle B | Status / Auflösung |

## A3 — Open Items / Unknowns
- [U-1]: <Was fehlt>, <welches Dokument würde schließen>

## A4 — Self-Check
- [ ] Alle 8 D-Sektionen bearbeitet (Lücken als [U])
- [ ] D2 IS/IS-NOT-Matrix vollständig oder Lücken als [U]
- [ ] Jeder Claim hat vollständige Toulmin-Struktur
- [ ] D4: bei ≥ 2 Hypothesen wurde ACH-Matrix erstellt
- [ ] D5/D6/D7: Schlussfolgerungen stützen sich nur auf E1/E2
- [ ] D3 (Containment) und D7 (Preventive) sauber getrennt
- [ ] Alle Hypothesen benennen fehlende UND widerlegende Evidenz
- [ ] Alle Konflikte im Conflict Log
- [ ] Alle Unknowns benannt mit "was würde sie schließen"
- [ ] Keine Forbidden Phrases im Output
- [ ] Document Ledger vollständig, KCS-Qualität bewertet

## A5 — Confidence Score
- Stammdaten-Vollständigkeit: x / 6
- IS/IS-NOT-Matrix: vollständig / Lücken
- ACH durchgeführt: ja/nein/n.a.
- Anteil E1/E2 in Belegkette: x %
- Offene Konflikte: n
- **Gesamt-Confidence: hoch / mittel / niedrig** + 1-Satz-Begründung
```

# REGELN
- Slots NICHT weglassen. Leerstand → `[U]` + Hinweis, welches Datum schließt.
- Forbidden Phrases vermeiden. Bei sinnvoller Unsicherheit → H1/H2-Slot.
- Conflict Log A2 wird genutzt, nicht "weggemittelt".
- D5/D6/D7-Schlussfolgerungen: AUSSCHLIEßLICH auf E1/E2.

# HANDOFF
```
## Handoff
**Next agent needs:** Case-Status (geschlossen/open/known-error), Known-Error-Eintrag falls erzeugt, offene [U]/[C] für Curator-Follow-up
<!-- trace: <trace_id> -->
```
