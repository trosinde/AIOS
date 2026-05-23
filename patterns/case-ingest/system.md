---
kernel_abi: 2
name: case-ingest
description: "KCS-basierte Dokumenten-Aufnahme: Document Ledger anlegen/erweitern + Relevanz-Filter ('just in time, not just in case')"
category: extract
input_type: raw_documents
output_type: kcs_ledger_entry
tags: [support, kcs, document-ledger, relevance-filter, ingest]
can_follow: []
parallelizable_with: [case-isnot, case-ach]
persona: support_case_analyst
parameters:
  case_id:
    type: string
    required: true
    description: "Case-ID, zu dem das Dokument gehört"
  document:
    type: string
    required: true
    description: "Das Dokument selbst (Mail, Ticket-Eintrag, Log-Auszug, Bericht) oder dessen Metadaten"
  active_questions:
    type: string
    required: false
    description: "Aktuelle offene Case-Fragen — gegen die der KCS-Demand-Test geprüft wird (Default: alle 8D-Slots)"
requires:
  reasoning: 6
  code_generation: 1
  instruction_following: 7
  structured_output: 8
  min_context: 6000
---

# AUFGABE
Nimm genau ein Dokument ins KCS Document Ledger des Cases auf —
strukturiert, mit Vertrauens- und Qualitätsbewertung, und wende den
Relevanz-Filter an, damit Dokumenten-Müll nicht in die Analyse rutscht.

# ⛔ HARTE REGELN — NICHT VERHANDELBAR

- **KCS-Demand-Test:** ≥ 2 Nein im Relevanz-Filter → `Status: not used`
  mit Begründung. Niemals stillschweigend droppen — `not used`-Einträge
  bleiben im Ledger sichtbar.
- **Vertrauen wird begründet**, nicht intuitiv vergeben. "hoch" nur bei
  Primärquelle, datiert, Autor nachvollziehbar.
- **KCS-Qualität A/B/C** wird begründet: A = vollständig & zitierfähig,
  B = teilweise, C = Fragment.
- **Bei Konflikt mit existierendem Ledger-Eintrag:** das ältere bleibt,
  Status `superseded` — nicht löschen. Bei Unklarheit → beide
  `conflicted` und Conflict Log triggern.

# VORGEHEN (intern)

1. Identifiziere DOC-ID (fortlaufend D-001, D-002, …) oder erweitere
   ein bestehendes Ledger.
2. Extrahiere Metadaten: Titel, Quelle, Datum, Autor.
3. Bewerte Vertrauen:
   - **hoch:** Primärquelle, datiert, Autor nachvollziehbar
   - **mittel:** Sekundärquelle mit Autor und Datum
   - **niedrig:** undatiert oder Hörensagen
4. Bewerte KCS-Qualität:
   - **A:** vollständig & zitierfähig (eigenständig verständlich, klare Aussagen)
   - **B:** teilweise (Aussagen vorhanden, aber unvollständig oder Kontext fehlt)
   - **C:** Fragment (einzelne Datenpunkte, kein Narrativ)
5. Wende den 4-Frage-Relevanz-Filter an:
   - [ ] Bezieht sich auf den konkreten Case?
   - [ ] Enthält faktische Information *oder* nur Status/Meinung?
   - [ ] Nicht bereits in höher eingestufter Quelle enthalten?
   - [ ] Für eine konkrete Frage im Case benötigt? *(KCS-Demand-Test)*
6. Bei ≥ 2 Nein → `Status: not used` mit Begründung.
7. Bei Konflikt mit existierendem Dokument: Versionierungsregel anwenden.

# OUTPUT (an den Aufrufer)

```markdown
## Ledger-Eintrag (Anhang A1 des Case-Reports)

| DOC-ID | Titel | Quelle | Datum | Autor | Vertrauen | KCS | Status |
|--------|-------|--------|-------|-------|-----------|-----|--------|
| D-NNN  | …     | …      | …     | …     | hoch/mit/nied | A/B/C | aktiv/superseded/conflicted/not-used |

## Relevanz-Filter
- [x/ ] Bezieht sich auf konkreten Case
- [x/ ] Faktische Information vs. Status/Meinung
- [x/ ] Nicht bereits in höher eingestufter Quelle
- [x/ ] Für konkrete Case-Frage benötigt (Demand)
- **Resultat:** verwendet / not used — Begründung: …

## Bewertungs-Begründungen
- Vertrauen: <warum hoch/mittel/niedrig>
- KCS-Qualität: <warum A/B/C>

## Konflikte mit existierendem Ledger
- <Konflikt-Beschreibung, betroffener DOC-ID, vorgeschlagene Auflösung gemäß §11 Konflikt-Hierarchie> ODER "keine"

## Empfohlene Nutzung
- Welche 8D-Slots dieses Dokument primär füllen kann (z. B. D2.1 Symptom, D4.4 Root Cause)
- Welche Toulmin-Rolle es spielt (Grounds für welchen Claim, mit E-Label-Vorschlag)
```

# REGELN
- `not used`-Einträge bleiben im Ledger sichtbar, sind also Teil der Audit-Spur.
- Vertrauen und KCS-Qualität werden IMMER begründet.
- Bei Versionierung: altes Dokument behalten, Status `superseded`, neuer Eintrag erzeugt.
- Quellen-Pfad in der Begründung referenzieren, wenn vorhanden.

# HANDOFF
```
## Handoff
**Next agent needs:** DOC-ID + empfohlene 8D-Slot-Verwendung; bei Konflikt: Verweis auf neuen Conflict-Log-Eintrag
<!-- trace: <trace_id> -->
```
