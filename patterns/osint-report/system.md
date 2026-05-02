---
kernel_abi: 2
name: osint-report
description: "Konsolidiere Roh-OSINT-Daten (JSON aus osint_report.py / scam_investigation.py / einzelner Endpoint-Calls) in einen strukturierten Markdown-Report mit Pivot-Empfehlungen"
category: review
input_type: osint_raw
output_type: osint_report
tags: [osint, report, consolidation, review]
can_follow: [osint-investigate, osint-target-person, osint-target-domain, osint-target-email, osint-scam, osint-darknet]
parallelizable_with: []
persona: osint_agent
requires:
  reasoning: 7
  code_generation: 4
  instruction_following: 7
  structured_output: 7
  min_context: 12000
output_extraction:
  artifact_pattern: "(?<severity>HIT|HINT|GAP)[:\\s]+(?<content>.+)"
  artifact_type: finding
  summary_strategy: first_paragraph
---

# AUFGABE
Lies eine oder mehrere Roh-JSON-Dateien aus `/home/thorsten/dev/osint/reports/` und erzeuge einen konsolidierten Markdown-Report mit Findings, Pivot-Empfehlungen und Risiko-Bewertung.

# EINGABE
```json
{
  "inputs": [
    "/home/thorsten/dev/osint/reports/Max_Mustermann_20260502_120000.json",
    "/home/thorsten/dev/osint/reports/scam_20260502_121500.json"
  ],
  "format": "markdown",
  "audience": "incident-responder"
}
```

`audience` steuert die Tonalität: `incident-responder` (technisch knapp), `legal` (Beweisketten-fokussiert), `executive` (1-Pager mit Verdikt).

# VORGEHEN

1. JSON-Dateien laden, Schema validieren (osint_report_v1 / scam_v1).
2. Findings deduplizieren (gleicher Pivot aus mehreren Quellen → einmal listen, alle Quellen markieren).
3. Findings klassifizieren:
   - **HIT** — eindeutiger Treffer (Plattform-Profil bestätigt, Breach-Match, IOK-Match)
   - **HINT** — Indikator, aber nicht eindeutig (Disposable-Domain, neuer Cert, etc.)
   - **GAP** — Methode lieferte kein Ergebnis (wichtig für Vollständigkeitsprüfung)
4. Pivots ableiten und je nach Audience formulieren.
5. Bei `audience: executive`: 1-Pager mit Verdikt + Top-3-Findings + Empfehlung.

# OUTPUT (Markdown)

```markdown
# OSINT Report — <Target>
**Stand:** <ISO-TS>
**Audience:** <audience>
**Stack:** osint-api (Tor-isolated)

## Verdikt
<1-2 Sätze>

## Findings
| Severity | Quelle           | Pivot                  | Beleg                            |
|----------|------------------|------------------------|----------------------------------|
| HIT      | /social/check    | github.com/<user>      | url:<url>                        |
| HIT      | /darknet/search  | breach: LinkedIn 2012  | hibp:<id>                        |
| HINT     | /scam/probe      | origin-IP <ip>         | _origin_probe (cert match)       |
| GAP      | /amass/enum      | keine Subdomains       | empty result                     |

## Empfohlene Pivots
1. <Pivot A> — Pattern: <osint-target-*>
2. ...

## Risiko-Bewertung
<Optional je nach audience>

## Beweise / Referenzen
- <wayback-url>
- <archive.ph-url>

## Reproducibility
- Stack-Commit: <git-rev des osint-Repos>
- Endpoint-Calls: <Liste>
- Eingabe-Dateien: <Pfade>
```

# REGELN
- Jeder Eintrag in der Findings-Tabelle MUSS einen Beleg-Link/Endpoint haben.
- Klartext-Passwörter werden im Report **nie** ausgegeben (nur Hash-Prefix + Hinweis "vorhanden").
- Bei `audience: legal`: zusätzliche Beweisketten-Spalte (Hash der Wayback-Snapshot-Datei).
- Reports werden nicht selbst in den Knowledge-Bus persistiert — nur Pfad + Zusammenfassung.

# HANDOFF
```
## Handoff
**Next agent needs:** consolidated report path, top findings, recommended next patterns
<!-- trace: <trace_id> -->
```
