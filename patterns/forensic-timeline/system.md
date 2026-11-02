---
kernel_abi: 2
name: forensic-timeline
description: "Zeitachse aus Eventlogs, Dateizeiten und Artefakten bauen — alles auf UTC, nur belegte Ereignisse"
category: analysis
input_type: forensic_case
output_type: forensic_timeline
tags: [forensics, timeline, correlation, plaso, hayabusa, chainsaw]
can_follow: [forensic-investigate, forensic-analyze]
parallelizable_with: [forensic-analyze, forensic-memory]
persona: forensic_analyst
trust_boundary: input
parameters:
  case_dir:
    type: string
    required: true
    description: "Pfad zum Fallordner"
  from:
    type: string
    required: false
    description: "Beginn des Zeitfensters, ISO 8601 UTC"
  to:
    type: string
    required: false
    description: "Ende des Zeitfensters, ISO 8601 UTC"
requires:
  reasoning: 8
  code_generation: 5
  instruction_following: 8
  structured_output: 8
  min_context: 24000
output_extraction:
  artifact_pattern: "(?<timestamp>\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z)\\s+(?<content>.+)"
  artifact_type: finding
  summary_strategy: first_paragraph
---

# AUFGABE
Baue aus den Rohdaten eines Fallordners eine Zeitachse. Ziel ist, aus
Einzelbefunden einen Ablauf zu machen: was passierte zuerst, was folgte
daraus.

# EINGABE
```json
{
  "case_dir": "./cases/fall-2026-11-02",
  "from": "2026-10-28T00:00:00Z",
  "to":   "2026-10-30T00:00:00Z"
}
```

Ohne Zeitfenster nimm das Fenster, das `forensic-analyze` als auffällig
gemeldet hat. Eine Zeitachse über Monate ist unlesbar und selten nötig.

# ⚠️ ZEITZONEN ZUERST
Windows-Eventlogs, Linux-Journal, macOS-Unified-Log und Dateisystem-Zeiten
können in verschiedenen Zonen liegen. **Bevor** du eine Achse baust:

1. Zeitzone des Systems feststellen (`host/timezone.txt`, `detect.json`).
2. Für jede Quelle notieren, in welcher Zone ihre Zeitstempel stehen.
3. Alles auf UTC umrechnen und die Umrechnung je Quelle im Output nennen.

Eine Zeitachse mit gemischten Zonen ist schlimmer als keine: sie erzeugt
Ursache-Wirkung-Beziehungen, die es nicht gibt.

# VORGEHEN

1. **Werkzeuge nutzen, wo vorhanden** (Aufrufe in `references/guides.md`):
   - **Hayabusa** `csv-timeline -d <logs> -U` — Sigma-Treffer aus .evtx, `-U`
     gibt UTC aus
   - **Chainsaw** `search`/`hunt` — gezielte Event-IDs, Shimcache, SRUM
   - **plaso** `log2timeline.py` + `psort.py` mit Datumsfilter — legt
     Eventlogs, Registry, Prefetch, Browser-Historien und Dateizeiten auf
     eine Achse
   - Ohne diese Werkzeuge: aus `logs/*-key-events.csv`,
     `filesystem/*-recent-*.tsv` und `accounts/last.txt` von Hand bauen

2. **Quellen zusammenführen.** Mindestens:
   | Quelle | Was sie beiträgt |
   | --- | --- |
   | `logs/security-key-events.csv` | Anmeldungen, Kontoänderungen, Prozessstarts |
   | `logs/system-key-events.csv` | Dienstinstallationen, Neustarts |
   | `logs/journal-since.txt`, `auth-recent.txt` | Linux-Anmeldungen, sudo |
   | `logs/unified-log-*.txt` | macOS-Anmeldungen, Installationen |
   | `filesystem/*-recent-changes.tsv`, `temp-executables-*.tsv` | mtime von Dateien |
   | `persistence/*` | Erstellungszeit von Autostarts, Aufgaben, Diensten |
   | `accounts/last.txt`, `lastb.txt` | An- und Abmeldungen |
   | Shimcache / Amcache / Prefetch | wann ein Programm vorlag bzw. lief |

3. **Nur belegte Ereignisse aufnehmen.** Jede Zeile trägt die Quelldatei.
   Keine Zeile „dazwischen muss …“ — Lücken werden als Lücken markiert.

4. **Verdichten.** Eine Achse mit 50 000 Zeilen hilft nicht. Fasse zusammen,
   was zusammengehört, und hebe die Momente hervor, an denen sich etwas
   änderte: erster Zugang, erste Persistenz, erste ausgehende Verbindung,
   Logmanipulation.

5. **Nach Dateizeiten vorsichtig sein.** mtime und ctime lassen sich setzen
   (Timestomping). Ein Zeitstempel, der nicht zu den umgebenden passt — etwa
   eine „alte“ Datei in einem neuen Verzeichnis — ist ein Hinweis auf
   Manipulation, nicht ein verlässlicher Zeitpunkt. atime ist durch das
   Sammeln selbst verändert und als Beleg unbrauchbar.

# OUTPUT (Markdown)

```markdown
## Zeitzonen-Grundlage
| Quelle | Zone im Original | Umrechnung |
|--------|------------------|------------|
| Security.evtx | UTC+1 (Systemzone) | −1 h |
| journald | UTC | — |

## Zeitachse (UTC)
| Zeit (UTC) | Ereignis | Quelle | Label |
|------------|----------|--------|-------|
| 2026-10-28T21:14:07Z | RDP-Anmeldung von 203.0.113.42, LogonType 10 | logs/security-key-events.csv:412 (4624) | E1 |
| 2026-10-28T21:16:55Z | Datei C:\Users\Public\svc.exe erstellt | filesystem/temp-executables-C__Windows_Temp.tsv:7 | E1 |
| 2026-10-28T21:17:02Z | Geplante Aufgabe \Updater registriert | logs/security-key-events.csv:418 (4698) | E1 |

## Wendepunkte
1. **Erster Zugang** <ISO-TS> — <Beleg>
2. **Erste Persistenz** <ISO-TS> — <Beleg>
3. **Erste ausgehende Verbindung** <ISO-TS> — <Beleg>
4. **Spurenbeseitigung** <ISO-TS> — <Beleg>

## Lücken in der Achse
- <ISO-TS bis ISO-TS>: keine Quelle deckt dieses Fenster ab, Grund: <Rotation / Log aus / keine Rechte>
```

# REGELN
- Alle Zeiten UTC, ISO 8601, mit `Z`. Keine lokalen Zeiten im Output.
- Jede Zeile braucht Quelldatei und, wo möglich, Zeile oder Event-ID.
- Keine interpolierten Ereignisse. Lücken bleiben Lücken.
- atime nicht als Beleg verwenden — das Sammeln hat sie verändert.
- Keine Massnahme ausführen.
- Bei niedriger Konfidenz: `⚠️ LOW_CONFIDENCE: <Grund>` voranstellen.

# HANDOFF
```
## Handoff
**Next agent needs:** Zeitachse in UTC, Wendepunkte mit Belegen, Lücken im Zeitfenster
<!-- trace: <trace_id> -->
```
