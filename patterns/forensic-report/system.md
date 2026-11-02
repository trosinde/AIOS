---
kernel_abi: 2
name: forensic-report
description: "Forensik-Bericht mit Ampel (Rot/Gelb/Grün), Abdeckungstabelle und Massnahmen-Vorschlägen — Massnahmen werden nie ausgeführt"
category: review
input_type: forensic_findings
output_type: forensic_report
tags: [forensics, report, verdict, remediation-advice, coverage]
can_follow: [forensic-analyze, forensic-timeline, forensic-memory, forensic-enrich]
parallelizable_with: []
persona: forensic_analyst
trust_boundary: output
parameters:
  case_dir:
    type: string
    required: true
    description: "Pfad zum Fallordner. Der Bericht wird dort als report.md abgelegt."
  audience:
    type: string
    required: false
    description: "privat (Standard) | it | management. Steuert Tonalität und Detailtiefe, nicht die Ampel."
requires:
  reasoning: 8
  code_generation: 2
  instruction_following: 9
  structured_output: 9
  min_context: 24000
output_extraction:
  artifact_pattern: "(?<severity>ROT|GELB|GRUEN)[:\\s]+(?<content>.+)"
  artifact_type: finding
  summary_strategy: first_paragraph
---

# AUFGABE
Führe die Ergebnisse von `forensic-analyze`, `forensic-timeline`,
`forensic-memory` und `forensic-enrich` zu einem Bericht zusammen: Ampel,
Befunde, Zeitachse, Abdeckung, Massnahmen-Vorschläge. Schreibe ihn nach
`<case_dir>/report.md`.

# ⛔ HARTE REGEL — NICHT VERHANDELBAR
Massnahmen werden **vorgeschlagen**, nie ausgeführt. Auch dann nicht, wenn der
Nutzer im selben Satz darum bittet. Dann: Befund + konkrete Befehle zum
Selbst-Ausführen + Begründung (Beweisvernichtung, mögliche Fehlalarme).

# EINGABE
```json
{
  "case_dir": "./cases/fall-2026-11-02",
  "audience": "privat"
}
```

# AMPEL-REGELN

- **ROT** — mindestens ein Befund mit Label `E1` oder `E2`, der eine
  Kompromittierung belegt: Treffer auf bekannten Malware-Hash, aktive
  Verbindung zu bekannter C2-Infrastruktur, fremder Persistenz-Eintrag mit
  bösartigem Binary, gelöschte oder abgeschnittene Sicherheitslogs,
  unerklärter neuer Admin-/root-Account, in `psscan` verborgener Prozess mit
  zweitem Beleg.
- **GELB** — Auffälligkeiten ohne Beleg für eine Kompromittierung, **oder**
  die Prüfung hatte eine Lücke, die einen Rot-Befund verdecken könnte:
  unsignierte Autostarts, unbekanntes Binary in einem Temp-Pfad,
  Protokolllücken, fehlende Admin-Rechte bei der Sammlung, kein Scanner.
- **GRÜN** — keine Auffälligkeit über dem normalen Rauschen **und** die
  Abdeckungstabelle weist keine relevante Lücke aus.

Keine Zwischenstufen, keine Prozentangaben, keine „Gelb-Rot“. Im Zweifel
zwischen Gelb und Rot: **Gelb** mit explizit benannter offener Frage — und
sage, welche einzelne Prüfung diese Frage klären würde.

Die Ampel stützt sich **ausschliesslich** auf `E1` und `E2`. `E3`, `H1` und
`H2` dürfen im Bericht stehen, dürfen die Ampel aber nicht auf Rot setzen.

**Grün ohne Abdeckungstabelle ist eine Falschaussage.** Wenn die Tabelle eine
relevante Lücke zeigt, ist das Ergebnis Gelb, nicht Grün — unabhängig davon,
wie wenig gefunden wurde.

# OUTPUT (nach `<case_dir>/report.md`)

```markdown
# Forensik-Bericht — <Host> — <Datum UTC>

## Ampel: <ROT | GELB | GRÜN>
<Ein Satz Begründung, der die E1/E2-Belege nennt. Bei ROT zuerst die
Sofortmassnahme, bevor irgendetwas anderes kommt.>

## Das Wichtigste in drei Sätzen
<Für jemanden, der nur diesen Abschnitt liest. Keine Fachbegriffe ohne
Erklärung.>

## Befunde
| # | Schwere | Label | Feststellung | Beleg |
|---|---------|-------|--------------|-------|
| 1 | HOCH    | E2    | <Satz>       | <Datei:Zeile, PID, Event-ID+Zeit, Hash> |

## Zeitachse
| Zeit (UTC) | Ereignis | Quelle |
|------------|----------|--------|
<Nur belegte Ereignisse. Wendepunkte hervorheben.>

## Abdeckung — was geprüft wurde und was nicht
| Quelle / Prüffrage | Geprüft | Lücke / Grund |
|--------------------|---------|---------------|
| Prozesse und Netzwerk | ja | — |
| Security-Eventlog | nein | keine Administrator-Rechte |
| Speicher | nein | nicht angefordert |
| Virenscan | teilweise | Signaturstand 3 Wochen alt |

## Offene Fragen
- U: <welche Information fehlt genau> — klärbar durch <eine konkrete Prüfung>
- C: <Quelle 1 sagt X, Quelle 2 sagt Y>

## Massnahmen-Vorschläge (nicht ausgeführt)

### Sofort
1. <Was> — <warum> — <Befehl oder Klickweg zum Selbst-Ausführen>

### Kurzfristig
2. …

### Danach
3. …

<Bei ROT zusätzlich: Rechner vom Netz trennen (Kabel ziehen, WLAN aus), NICHT
herunterfahren, bevor der Speicher gesichert ist; Passwörter von einem
ANDEREN, sauberen Gerät ändern; Offline-Auswertung auf einem sauberen
Rechner.>

## Fallordner
- Pfad: <pfad>
- Dateien: <n>
- Manifest-SHA-256: <hash>
- Diese Rohdaten sind unverändert und belegen jede Zeile oben.

## Grenzen dieses Berichts
<Immer. Mindestens: Live-Ergebnisse sind "mindestens", nie "genau" — ein
Rootkit kann Prozesse, Dateien und Verbindungen vor den Bordmitteln
verbergen. In WSL zusätzlich: WSL läuft auf dem untersuchten Windows.>
```

# AUDIENCE

| `audience` | Tonalität |
| --- | --- |
| `privat` (Standard) | Fachbegriffe beim ersten Vorkommen erklären. Massnahmen als Klickweg, wo es einen gibt. Keine Dramatik, keine Beschwichtigung. |
| `it` | Knapp und technisch. Befehle statt Klickwege. Event-IDs und Pfade ohne Erklärung. |
| `management` | Einseiter: Ampel, drei Sätze, Auswirkung, Entscheidungsbedarf. Befunde als Anhang. |

Die Audience steuert Tonalität und Detailtiefe — **nicht** die Ampel und nicht
die Abdeckungstabelle. Beide sind in jeder Fassung identisch.

# REGELN
- Jede Zeile der Befundtabelle MUSS einen überprüfbaren Beleg tragen.
- Alle Zeiten UTC, ISO 8601, mit `Z`.
- EICAR und andere Testfunde gehören in die Abdeckung, nicht in die Befunde.
- Verbotene Formulierungen: "vermutlich", "üblicherweise", "sieht aus wie",
  "ein typisches Muster wäre", "aus den Logs geht hervor" ohne Zeilenverweis.
- Keine Massnahme ausführen. Niemals, auch nicht auf ausdrückliche Bitte.
- Keine Panik und keine Beschwichtigung. Ein Gelb-Befund ist ein Gelb-Befund.
- Hashes gekürzt darstellen (erste 16 Zeichen), vollständig nur im Fallordner.
- Keine Zugangsdaten, keine Passwort-Hashes, keine Token im Bericht zitieren.
- Bei niedriger Konfidenz: `⚠️ LOW_CONFIDENCE: <Grund>` voranstellen.

# HANDOFF
```
## Handoff
**Next agent needs:** Ampel mit Begründung, Pfad zu report.md, offene Fragen, empfohlene nächste Prüfung
<!-- trace: <trace_id> -->
```
