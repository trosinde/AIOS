---
kernel_abi: 2
name: forensic-enrich
description: "Hashes aus einem Fallordner nach aussen abgleichen (VirusTotal, MalwareBazaar, CIRCL) — nur Hashes, nie Dateien"
category: analysis
input_type: forensic_findings
output_type: forensic_enrichment
tags: [forensics, enrichment, virustotal, malwarebazaar, hashlookup, privacy]
can_follow: [forensic-analyze, forensic-memory]
parallelizable_with: [forensic-timeline]
persona: forensic_analyst
trust_boundary: output
parameters:
  case_dir:
    type: string
    required: true
    description: "Pfad zum Fallordner"
  hashes:
    type: string
    required: false
    description: "Einzelne SHA-256-Werte, durch Komma getrennt. Ohne Angabe die Hashes aus hashes/*."
  consent:
    type: boolean
    required: false
    description: "Bestätigung des Nutzers, dass Hashes abgefragt werden dürfen. Ohne diese wird nur CIRCL gefragt bzw. nachgefragt."
requires:
  reasoning: 7
  code_generation: 5
  instruction_following: 9
  structured_output: 8
  min_context: 12000
output_extraction:
  artifact_pattern: "(?<severity>TREFFER|BEKANNT_GUT|UNBEKANNT)[:\\s]+(?<content>.+)"
  artifact_type: finding
  summary_strategy: first_paragraph
---

# AUFGABE
Reichere Hashes aus einem Fallordner über externe Dienste an. Ziel: die Liste
der zu prüfenden Dateien kleiner machen und bekannte Schadsoftware benennen.

# ⛔ HARTE REGEL — NICHT VERHANDELBAR
**Nur Hashes gehen nach aussen. Nie Dateien.**

Keine Dateien hochladen, keine Dateiinhalte, keine Pfade mit Nutzernamen,
keine Hostnamen, keine internen IP-Adressen, keine Logauszüge, keine
Speicherabbilder, keine E-Mail-Adressen.

Gründe, die nicht verhandelbar sind:
- Eine Einreichung bei VirusTotal ist für andere zahlende Nutzer
  herunterladbar. Das ist eine Preisgabe, die nicht rückholbar ist.
- Ein Upload kann eine Meldepflicht auslösen (DSGVO Art. 33) oder einen
  Vertrag brechen.

# ⚠️ VOR DER ERSTEN ABFRAGE FRAGEN
Ein Hash-Lookup ist für den Angreifer sichtbar, **wenn er die Datei selbst
eingereicht hat**: er sieht an der Abfragestatistik, dass jemand sucht. Das
ist ein Grund zu fragen, nicht ein Grund zu lassen.

Ohne `consent: true` fragst du den Nutzer: welche Dienste, wie viele Hashes.
CIRCL hashlookup (nur bekannte **gute** Dateien, kein API-Schlüssel) ist der
unkritischste Einstieg und darf nach kurzer Ankündigung laufen.

# VORGEHEN

1. **Hashes sammeln** aus `hashes/process-binaries.*`,
   `hashes/service-binaries.csv`, `hashes/scheduled-task-binaries.csv`,
   `hashes/temp-executables.csv`. Deduplizieren.

2. **Erst entlasten, dann belasten.** CIRCL hashlookup zuerst: was dort als
   bekannt gute Datei geführt wird, fällt aus der Prüfliste. Das reduziert die
   Arbeit meist um den grössten Teil — und verbraucht kein Kontingent.

3. **Nur die unbekannten weiter abfragen.** VirusTotal und MalwareBazaar.
   Freier VirusTotal-Schlüssel: 4 Abfragen pro Minute, 500 pro Tag — also
   priorisieren, nicht alles durchschieben. Die konkreten Befehle stehen in
   `.claude/skills/host-forensics/references/enrichment.md`.

4. **Schlüssel über Umgebungsvariablen** (`VT_API_KEY`, `MB_API_KEY`), nie als
   Kommandozeilen-Argument — dort landen sie in der Prozessliste und in der
   Shell-Historie.

5. **Ergebnisse einordnen.**
   | Ergebnis | Label | Begründung |
   | --- | --- | --- |
   | Viele übereinstimmende Urteile, benannte Familie | `E1` | Eindeutige Zuordnung |
   | Externer Treffer **und** lokaler Scanner-Treffer | `E2` | Zwei unabhängige Quellen |
   | Einzelnes Urteil einer Engine | `E3` | Oft Heuristik, Falschalarm möglich |
   | Nicht bekannt | `U` | **Kein Freispruch** |
   | CIRCL kennt die Datei als gut | `E1` entlastend | Teil einer bekannten Verteilung |

   „0/70“ heisst: keine Engine kennt diese Datei. Bei einer Datei, die seit
   Jahren Teil des Betriebssystems ist, wäre das seltsam. Bei einer Datei, die
   vor zwei Tagen in einem Temp-Pfad auftauchte, ist es genau das, was man bei
   einem gezielten Angriff erwartet.

6. **Gegenstellen aus Verbindungen** dürfen geprüft werden (Reverse-DNS,
   WHOIS). Eine verdächtige URL **nicht** im Browser öffnen und nicht direkt
   mit `curl` abholen: das bestätigt dem Angreifer die Beobachtung und kann
   weitere Nutzlast nachladen. Wenn Inhalt nötig ist: urlscan.io oder ein
   Archiv-Snapshot.

# OUTPUT (Markdown)

```markdown
## Abgefragt
- Dienste: <CIRCL | VirusTotal | MalwareBazaar>
- Zustimmung des Nutzers: ja (<wann/wie>) | nur CIRCL
- Hashes abgefragt: <n> von <m> (Auswahlkriterium: <…>)

## Treffer
| SHA-256 (gekürzt) | Urteile | Familie | Datei im Fall | Label |
|-------------------|---------|---------|---------------|-------|

## Bekannt gut (aus der Prüfliste entfernt)
<n> Hashes, Dienst: CIRCL hashlookup

## Unbekannt (weiter zu prüfen)
| SHA-256 (gekürzt) | Datei im Fall | Warum weiter prüfen |
|-------------------|---------------|---------------------|

## Nicht abgefragt
- <n> Hashes, Grund: <Kontingent | keine Zustimmung | kein Schlüssel>
```

# REGELN
- Keine Datei hochladen. Keine Ausnahme, kein „nur zum Test“.
- Keine Pfade mit Nutzernamen, keine Hostnamen, keine internen IPs nach aussen.
- Hashes im Bericht gekürzt darstellen (erste 16 Zeichen), vollständig nur im
  Fallordner.
- „Nicht bekannt“ niemals als „sauber“ berichten.
- Keine Massnahme ausführen.
- Bei niedriger Konfidenz: `⚠️ LOW_CONFIDENCE: <Grund>` voranstellen.

# HANDOFF
```
## Handoff
**Next agent needs:** Treffer mit Familie und Label, entlastete Hashes, weiter zu prüfende Hashes, was aus welchem Grund nicht abgefragt wurde
<!-- trace: <trace_id> -->
```
