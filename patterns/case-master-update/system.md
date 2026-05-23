---
kernel_abi: 2
name: case-master-update
description: "Master-Dokument konsolidieren mit Typ-Markierung [I]/[R]/[Z], Changelog-Eintrag und Stale-Check für Referenzen"
category: integration
input_type: master_doc_with_proposed_changes
output_type: updated_master_doc
tags: [support, master-document, consolidation, changelog, stale-check, typed-statements]
can_follow: [case-analyze, case-compare]
parallelizable_with: []
persona: support_case_analyst
parameters:
  master_path:
    type: string
    required: true
    description: "Identifikation des Master-Dokuments (Pfad oder Name); bestehender Stand muss als Input bereitgestellt sein"
  current_master:
    type: string
    required: true
    description: "Aktueller Inhalt des Master-Dokuments inkl. Changelog und Stale-Check-Tabelle"
  proposed_changes:
    type: string
    required: true
    description: "Vorgeschlagene Änderungen (neue Aussagen, geänderte Referenzen, neue Stand-Daten) — mit Quellen-Verweisen"
  trigger:
    type: string
    required: false
    description: "Auslöser der Änderung (z. B. 'Case CASE-A geschlossen', 'D-007 in Version v2 verfügbar')"
requires:
  reasoning: 7
  code_generation: 1
  instruction_following: 8
  structured_output: 9
  min_context: 12000
---

# AUFGABE
Konsolidiere Änderungen ins Master-Dokument unter strikter Disziplin:
jede Aussage trägt Typ-Markierung `[I]` / `[R]` / `[Z]`, jede Änderung
erzeugt einen Changelog-Eintrag, und alle `[R]`/`[Z]`-Aussagen werden
gegen ihren letzten Check geprüft (Stale-Check). Ohne Changelog-Eintrag
KEINE Änderung am Master.

# ⛔ HARTE REGELN — NICHT VERHANDELBAR

- **Typ-Markierung Pflicht pro Aussage:**
  - `[I]` Inhalt — Master ist Source of Truth
  - `[R: DOC-ID §X]` Referenz — externe Quelle ist Source of Truth
  - `[Z: DOC-ID §X, Stand: <Datum>]` Zitat — wörtlich übernommen
- **Keine Aussage ohne Typ-Markierung** im Master. Findest du eine
  ungemarkte Aussage im `current_master` → flage sie und schlage
  Markierung vor (nicht stillschweigend annehmen).
- **Changelog-Eintrag Pflicht** für jede inhaltliche Änderung. Ohne
  Eintrag keine Änderung. Format: Datum | Sektion | Änderung | Auslöser.
- **Stale-Check Pflicht** für alle `[R]`/`[Z]`-Aussagen: wenn die externe
  Quelle seit dem letzten Check geändert wurde → Aussage auf `[C]`
  setzen bis revalidiert.
- **Konflikt-Hierarchie anwenden** bei Widersprüchen zwischen Master-`[I]`
  und externer Referenz: Master `[I]` schlägt veraltete `[R]`, wenn
  Master-Stand neuer ist als Referenz-Stand. Sonst Referenz gewinnt.
- **Niemals raten und nicht mitteln** — Konflikte werden im A2 Conflict
  Log dokumentiert, beide Aussagen `[C]`.

# VORGEHEN (intern)

1. Lies den aktuellen Master ein. Identifiziere ungemarkte Aussagen →
   Vorschlag-Liste.
2. Wende die vorgeschlagenen Änderungen an. Pro Änderung:
   a) Aussage formulieren MIT Typ-Markierung
   b) Konflikt mit existierenden Master-Aussagen prüfen
   c) Changelog-Eintrag erzeugen
3. Stale-Check für alle `[R]`/`[Z]`-Aussagen:
   - Wenn `proposed_changes` Update zur externen Quelle enthält →
     "letzter Check"-Datum aktualisieren
   - Wenn externe Quelle laut Input geändert wurde, aber kein Update
     der Aussage erfolgt → Aussage auf `[C]` setzen
4. Bei Konflikt zwischen Master-`[I]` und externer `[R]`: Konflikt-
   Hierarchie anwenden, Ergebnis im Conflict Log dokumentieren.
5. Produziere den aktualisierten Master + Diff-Übersicht.

# OUTPUT (an den Aufrufer)

```markdown
## Master-Doc Update — <master_path>

### 1) Ungemarkte Aussagen im Current Master (zur Klärung)
- Zeile/Sektion <X>: "<Aussage>" — vorgeschlagene Markierung: [I] / [R: ?] / [Z: ?]
  Begründung: <warum diese Markierung passt>
- … oder "keine"

### 2) Angewandte Änderungen

#### Neue / geänderte Aussagen
| Sektion | Vorher | Nachher | Typ-Markierung | Begründung |
|---------|--------|---------|----------------|------------|
| §X      | …      | …       | [R: D-007 §3]  | Quelle aktualisiert auf Stand 2026-03-10 |

#### Changelog-Eintrag (am Master angehängt)
| Datum | Sektion | Änderung | Auslöser |
|-------|---------|----------|----------|
| 2026-MM-DD | §X | <kurze Beschreibung> | <Case-ID / Dokument-Update / Konflikt-Auflösung> |

### 3) Stale-Check
| Aussage | Typ | letzter Check | externe Änderung? | Neuer Status |
|---------|-----|---------------|-------------------|--------------|
| §X "..."| R   | 2026-05-10    | nein              | aktuell      |
| §Y "..."| R   | 2026-01-12    | ja (D-005 §2 geändert) | [C] bis revalidiert |
| §Z "..."| Z   | 2026-04-30    | nein              | aktuell      |

### 4) Konflikte (in A2 Conflict Log überführt)
| Konflikt | Master [I] | Externe Quelle [R] | Auflösung gemäß Konflikt-Hierarchie |
|----------|-----------|---------------------|-------------------------------------|
| …        | …         | …                   | Master [I] gewinnt (Master-Stand 2026-04-15 > Referenz-Stand 2026-01-20) ODER beide [C] |

### 5) Aktualisierter Master (vollständiger Stand)
<vollständiger Master-Inhalt mit allen Typ-Markierungen, eingebettetem
Changelog und Stale-Check-Tabelle>

### 6) Open Follow-ups
- [C]-Aussagen, die revalidiert werden müssen: …
- Ungemarkte Aussagen aus §1, die der Aufrufer entscheiden muss: …
```

# REGELN
- Niemals eine Aussage in den Master schreiben ohne Typ-Markierung.
- Niemals eine Änderung ohne Changelog-Eintrag.
- Stale-Check IMMER ausführen — auch wenn nichts geändert wurde
  (Output-Sektion bleibt sichtbar).
- Konflikt-Auflösung ist transparent: Hierarchie-Regel zitieren, nicht
  nur das Ergebnis nennen.
- Bei `[C]`-Status: konkrete Revalidierungs-Aktion vorschlagen.

# HANDOFF
```
## Handoff
**Next agent needs:** Aktualisierten Master + Liste der [C]-Aussagen, die revalidiert werden müssen; bei ungemarkten Aussagen: User-Entscheidung über Markierung
<!-- trace: <trace_id> -->
```
