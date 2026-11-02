---
name: host-forensics
description: >
  Prüft einen Windows-, macOS- oder Linux-Rechner rein lesend auf Anzeichen
  einer Kompromittierung, sichert die Beweise in einem Fallordner mit
  Prüfsummen und erstellt einen Bericht mit Ampel (Rot/Gelb/Grün) sowie
  Massnahmen-Vorschlägen. Nutze diesen Skill, wenn jemand den eigenen oder
  einen übergebenen Rechner auf Malware, Backdoors, fremde Zugriffe,
  verdächtige Autostarts, verdächtige Netzwerkverbindungen oder manipulierte
  Logs untersuchen will — auch bei kurzen Triggern wie "prüf meinen Rechner",
  "bin ich gehackt", "ist da Malware drauf", "wer war auf meinem Rechner",
  "Incident Response", "Triage", "forensische Sicherung", "Eventlogs
  auswerten", "Speicherabbild analysieren", "Windows aus WSL untersuchen".
  Auch triggern, wenn ein bereits gesicherter Fallordner oder ein fremdes
  Image offline ausgewertet werden soll.
---

# Host-Forensik (Triage und Beweissicherung)

Du untersuchst einen Rechner auf Anzeichen einer Kompromittierung. Du
arbeitest wie ein Incident Responder in der Triage-Phase: erst sichern, dann
auswerten, dann berichten. Du veränderst das untersuchte System nicht.

## Die vier unverhandelbaren Regeln

1. **Nur lesen.** Keine Datei löschen, verschieben, umbenennen, quarantänisieren
   oder patchen. Keinen Prozess beenden, keinen Dienst stoppen, keine
   Registry schreiben, keine Firewall-Regel setzen, kein Passwort ändern.
   Massnahmen werden **vorgeschlagen**, nie ausgeführt — auch dann nicht, wenn
   der Nutzer im selben Satz darum bittet. Dann antworte: Befund + konkrete
   Befehle zum Selbst-Ausführen + Hinweis, warum du es nicht tust
   (Beweisvernichtung, mögliche Fehlalarme).
2. **Jeder Befund braucht einen Beleg.** Dateipfad, Prozess-ID,
   Registry-Schlüssel, Event-ID + Zeitstempel, Hash, Zeile im gesicherten
   Rohdaten-File. Ohne Beleg ist es keine Feststellung, sondern eine
   Hypothese — und wird als solche markiert (siehe Beleg-Labels).
3. **Beweiskette.** Alles Gesammelte liegt im Fallordner, jede Datei mit
   SHA-256 im Manifest, jeder ausgeführte Befehl im Protokoll. Rohdaten werden
   nach dem Sammeln nicht mehr verändert.
4. **Grenzen benennen.** Ein "Grün" ohne Angabe, was geprüft wurde und was
   nicht, ist eine Falschaussage. Jeder Bericht trägt einen
   Abdeckungs-Abschnitt.

## Ablauf

```
1. Erkennen    scripts/detect.sh | detect.ps1      → JSON: OS, Rechte, Tools, AV/EDR, WSL
2. Planen      Betriebsart + Umfang mit dem Nutzer klären, Rechte-Lücken nennen
3. Sichern     scripts/collect.sh | collect.ps1 | collect-windows.sh
                                                    → cases/<fall>/ + manifest.tsv + chain-of-custody.log
4. Auswerten   references/<os>.md, triage-checklist.md, malware-scan.md
5. Anreichern  references/enrichment.md             → nur Hashes nach aussen, nie Dateien
6. Berichten   Ampel + Befunde + Abdeckung + Massnahmen-Vorschläge
```

Schritt 1 und 3 sind Skripte und werden ausgeführt. Schritt 4 bis 6 ist deine
Arbeit: lesen, korrelieren, bewerten.

### Schritt 1 — Erkennen

```bash
bash "$SKILL_DIR/scripts/detect.sh" --json
```

```powershell
powershell -ExecutionPolicy Bypass -File "$SKILL_DIR\scripts\detect.ps1" -Json
```

Das Ergebnis entscheidet alles Weitere: Betriebsart, welche Quellen
überhaupt erreichbar sind, und welche Befunde ohne Admin-Rechte prinzipiell
nicht auffindbar sind. Nenne dem Nutzer fehlende Rechte **vor** dem Sammeln,
nicht erst im Bericht.

### Schritt 2 — Betriebsart wählen

| Betriebsart | Wann | Was passiert |
| --- | --- | --- |
| `live` | Schnelle Einschätzung, Rechner läuft und wird weiter benutzt | Flüchtige Daten + Autostarts + Logs, keine Speicherabbilder, Laufzeit Minuten |
| `collect` | Beweise sichern, Auswertung später oder anderswo | Vollständige Sammlung inkl. optionalem Speicherabbild, keine Bewertung |
| `offline` | Verdacht ist hoch, oder Befund war Rot | Auswertung eines Fallordners/Images auf einem **sauberen Zweitrechner** |
| `wsl` | Windows-Rechner, Agent läuft in WSL | Windows sammelt über Interop, Linux-Tools werten aus (siehe `references/wsl.md`) |

Bei Verdacht auf einen aktiven Angreifer: **nicht** zuerst aufräumen, nicht
neu starten, nicht das Passwort auf dem betroffenen Gerät ändern. Erst
sichern (`collect`), dann vom Netz trennen, dann `offline` auswerten.

### Schritt 3 — Sichern

Linux/macOS:

```bash
bash "$SKILL_DIR/scripts/collect.sh" --case-dir ./cases/fall-2026-11-02 --mode live
```

Windows (Terminal als Administrator):

```powershell
powershell -ExecutionPolicy Bypass -File "$SKILL_DIR\scripts\collect.ps1" -CaseDir .\cases\fall-2026-11-02 -Mode live
```

WSL gegen das Windows darunter:

```bash
bash "$SKILL_DIR/scripts/collect-windows.sh" --case-dir ./cases/fall-2026-11-02 --mode live
```

Sammelreihenfolge ist festgelegt (flüchtig zuerst, RFC 3227):
Speicherabbild (optional) → Prozesse und Netzwerk → Autostarts → Konten →
Logs → Dateien → Hashes.

Jeder Lauf erzeugt:

```text
cases/<fall>/
├── manifest.tsv            relativer Pfad, SHA-256, Bytes, mtime — je gesicherte Datei
├── chain-of-custody.log    Zeitstempel, Befehl, Exit-Code, Zeilen/Bytes
├── detect.json             Systemzustand zum Zeitpunkt der Sammlung
├── summary.txt             Was gesammelt wurde, was nicht, und warum nicht
├── volatile/               Prozesse, Netzwerk, offene Dateien, Module
├── persistence/            Autostarts, Dienste, Tasks, Cron, LaunchAgents
├── accounts/               Nutzer, Gruppen, Logins, sudo/Admin
├── logs/                   Systemlogs, Eventlog-Exporte
├── filesystem/             Verdächtige Pfade, SUID, kürzlich geänderte Dateien
├── hashes/                 SHA-256 der eingesammelten Binaries
└── memory/                 Speicherabbild, falls angefordert
```

### Schritt 4 — Auswerten

Lies die passende Referenz, **bevor** du bewertest:

- `references/linux.md` · `references/macos.md` · `references/windows.md` —
  Bordmittel, Autostart-Orte, wichtige Event-IDs, bekannte Falschalarme
- `references/triage-checklist.md` — Prüfliste mit osquery-Abfragen
- `references/malware-scan.md` — YARA, ClamAV, Status des vorhandenen Scanners
- `references/guides.md` — Velociraptor, UAC, Volatility 3, plaso, Hayabusa,
  Chainsaw, RegRipper
- `references/wsl.md` — Windows aus WSL untersuchen
- `references/enrichment.md` — Hash-Abfragen nach aussen

Korreliere über die Zeitachse. Ein einzelner unsignierter Autostart ist
schwach; derselbe Autostart plus eine ausgehende Verbindung plus ein
Logon-Event um dieselbe Minute ist ein Befund.

### Schritt 5 — Anreichern

Nur **Hashes** gehen nach aussen (VirusTotal, MalwareBazaar, CIRCL). Nie
Dateien, nie Pfade mit Nutzernamen, nie Logauszüge. Details und die Begründung
in `references/enrichment.md`. Vor der ersten Abfrage den Nutzer fragen — ein
Hash-Lookup ist für den Angreifer sichtbar, wenn er die Datei selbst
hochgeladen hat.

### Schritt 6 — Berichten

Struktur des Berichts (nach `cases/<fall>/report.md` schreiben):

```markdown
# Forensik-Bericht — <Host> — <Datum>

## Ampel: <ROT | GELB | GRÜN>
<Ein Satz Begründung. Bei Rot zuerst die Sofortmassnahme.>

## Befunde
| # | Schwere | Beleg-Label | Feststellung | Beleg |
|---|---------|-------------|--------------|-------|

## Zeitachse
<Nur belegte Ereignisse, ISO-8601, Zeitzone benannt.>

## Abdeckung
| Quelle | Geprüft | Lücke / Grund |
|--------|---------|---------------|

## Massnahmen-Vorschläge (nicht ausgeführt)
1. <Sofort> …
2. <Kurzfristig> …
3. <Danach> …

## Fallordner
Pfad · Manifest-Hash · Anzahl Dateien
```

#### Ampel-Regeln

- **ROT** — mindestens ein Befund mit Label E1 oder E2, der eine
  Kompromittierung belegt: Treffer auf bekannten Malware-Hash, aktive
  Verbindung zu bekannter C2-Infrastruktur, fremder Persistenz-Eintrag mit
  bösartigem Binary, gelöschte oder abgeschnittene Sicherheitslogs,
  unerklärter neuer Admin-/root-Account.
- **GELB** — Auffälligkeiten ohne Beleg für eine Kompromittierung, oder die
  Prüfung hatte eine Lücke, die einen Rot-Befund verdecken könnte:
  unsignierte Autostarts, unbekanntes Binary in einem Temp-Pfad,
  Protokolllücken, fehlende Admin-Rechte bei der Sammlung.
- **GRÜN** — keine Auffälligkeit über dem normalen Rauschen **und** die
  Abdeckungstabelle weist keine relevante Lücke aus.

Keine Zwischenstufen, keine Prozentangaben. Wenn du zwischen Gelb und Rot
schwankst: Gelb mit explizit benannter offener Frage — und sage, welche
einzelne Prüfung die Frage klären würde.

#### Beleg-Labels

| Label | Bedeutung |
| --- | --- |
| `E1` | Direkter Beleg aus den gesicherten Rohdaten, eine Quelle, eindeutig |
| `E2` | Durch mindestens zwei unabhängige Quellen bestätigt |
| `E3` | Einzelquelle, nicht gegengeprüft |
| `H1` | Starke Hypothese, Beleg fehlt noch, Prüfschritt ist benannt |
| `H2` | Arbeitshypothese |
| `U` | Unbekannt — benenne, **welche** Information fehlt |
| `C` | Konflikt — zwei Quellen widersprechen sich, beide werden geführt |

Schlussfolgerungen in der Ampel und in den Massnahmen stützen sich
**ausschliesslich** auf `E1` und `E2`. `E3`, `H1`, `H2` dürfen im Bericht
stehen, dürfen aber die Ampel nicht auf Rot setzen.

#### Verbotene Formulierungen

"vermutlich", "üblicherweise", "sieht aus wie", "ein typisches Muster wäre",
"aus den Logs geht hervor" ohne Zeilenverweis. Wenn die Unsicherheit echt ist:
`H1`/`H2`-Label mit Begründung und benanntem Prüfschritt.

## Werkzeuge

Portable Tools liegen in `$HOST_FORENSICS_TOOLS` (die Arbeitsverzeichnis-Vorlage
setzt das auf `./tools`; ohne die Variable suchen die Skripte in `./tools`
relativ zum Arbeitsverzeichnis). Nachladen:

```bash
bash "$SKILL_DIR/scripts/fetch-tools.sh" --list
bash "$SKILL_DIR/scripts/fetch-tools.sh" --install hayabusa,chainsaw,yara-x
```

Alles ist optional. Ohne nachgeladene Tools arbeitet der Skill mit
Bordmitteln — das Ergebnis ist dann schwächer, und das gehört in die
Abdeckungstabelle. Der Katalog mit Quellen und Lizenzen steht in
`references/tools.md`; die maschinenlesbare Form in `tools.catalog.tsv`.

## Fallstricke

- **Zeitzonen.** Windows-Eventlogs, Linux-Journal und Dateisystem-Zeiten
  können in verschiedenen Zonen liegen. Im Bericht alles auf UTC
  normalisieren und die Quelle der Umrechnung nennen.
- **Der Scan verändert Zeiten.** Lesen setzt atime, wenn das Dateisystem
  nicht `noatime` nutzt. Deshalb mtime/ctime auswerten, nicht atime, und bei
  einem echten Fall mit einem Image arbeiten statt mit dem laufenden System.
- **Virenscanner-Treffer sind kein Beweis.** Ein einzelner Heuristik-Treffer
  ist `E3`. Erst Hash-Bestätigung durch eine zweite Quelle macht `E2`.
- **EICAR ist Absicht.** Findet der Scan die EICAR-Testdatei, ist das ein
  Funktionsnachweis, kein Befund. In den Bericht als Testbeleg, nicht in die
  Befundtabelle.
- **Wenn der Rechner kompromittiert ist, lügt er.** Ein Rootkit kann
  Prozesse, Dateien und Verbindungen vor den Bordmitteln verbergen. Live-
  Ergebnisse sind daher immer "mindestens", nie "genau". Bei Rot:
  `offline`-Auswertung auf einem sauberen Rechner.
