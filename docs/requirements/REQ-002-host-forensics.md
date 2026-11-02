# REQ-002: Host-Forensik-Skill für Claude Code und GitHub Copilot CLI

| Feld        | Wert                                                       |
|-------------|------------------------------------------------------------|
| ID          | REQ-002                                                    |
| Titel       | Rein lesende Host-Forensik mit Fallordner und Ampel-Bericht |
| Status      | Umgesetzt                                                  |
| Priorität   | Hoch                                                       |
| Typ         | Skill / Developer Experience / Security                    |

## Kontext

Claude Code und GitHub Copilot CLI lesen beide Skills aus `.claude/skills/`
(Copilot CLI: [Create skills for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills)).
Ein Skill in diesem Verzeichnis ist damit in beiden Agenten nutzbar, ohne den
Inhalt zu duplizieren.

Es fehlte eine Fähigkeit, die einen konkreten Rechner auf Anzeichen einer
Kompromittierung prüft. Die bestehenden Personas decken das nicht ab: ARGUS
(`osint_agent`) recherchiert passiv über öffentliche Quellen, CIPHER
(`security_expert`) prüft Entwürfe, PROBE (`support_case_analyst`) führt
Supportfälle durch den 8D-Lifecycle. Keiner von ihnen arbeitet am laufenden
oder gesicherten System.

Die beiden Eigenschaften, die so eine Fähigkeit tragen oder scheitern lassen:

1. **Sie darf nichts verändern.** Ein vorschnelles Aufräumen vernichtet
   Beweise, und bei einem Fehlalarm richtet es den Schaden an, den es
   verhindern sollte.
2. **Sie muss ihre Lücken beziffern.** Ein „keine Auffälligkeiten“ ohne
   Angabe, was nicht geprüft werden konnte, ist eine Falschaussage — und
   gefährlicher als kein Ergebnis.

## User Story

> Als AIOS-Nutzer möchte ich in einem eigenen Arbeitsverzeichnis einen Agenten
> fragen können „prüf meinen Rechner auf verdächtige Aktivität“ und einen
> belegten Bericht mit Ampel erhalten, ohne dass mein System dabei verändert
> wird und ohne dass meine Dateipfade und Logs den Rechner verlassen.

## Funktionale Anforderungen

- **FR-1**: Ein Skill `host-forensics` liegt unter
  `.claude/skills/host-forensics/` und wird von Claude Code und GitHub
  Copilot CLI aus derselben Quelle gelesen.
- **FR-2**: Der Skill prüft Windows, macOS und Linux **rein lesend**. Er
  löscht, verschiebt, quarantänisiert und patcht nichts, beendet keinen
  Prozess, stoppt keinen Dienst und ändert kein Passwort. Massnahmen werden
  vorgeschlagen, auch wenn der Nutzer um Ausführung bittet.
- **FR-3**: Vier Betriebsarten: `live` (schnelle Momentaufnahme), `collect`
  (vollständige Sicherung), `offline` (Auswertung auf einem sauberen
  Zweitrechner), `wsl` (Windows sammelt über Interop, Linux wertet aus).
- **FR-4**: `scripts/detect.sh` und `scripts/detect.ps1` ermitteln als JSON:
  Betriebssystem, Rechte, vorhandene Werkzeuge, Virenscanner/EDR,
  Protokoll-Abdeckung und WSL-Status, dazu eine Liste der Prüf-Grenzen.
- **FR-5**: `scripts/collect.sh`, `scripts/collect.ps1` und
  `scripts/collect-windows.sh` sichern in der Reihenfolge nach RFC 3227
  (flüchtig zuerst) in einen Fallordner mit `manifest.tsv` (SHA-256 je Datei)
  und `chain-of-custody.log` (Zeitstempel, Befehl, Exit-Code, Bytes).
- **FR-6**: `summary.txt` trennt drei Zustände: *nicht gesammelt* (Lücke),
  *geprüft ohne Treffer* (Feststellung) und *Befehl mit Fehler* (unvollständig).
- **FR-7**: `scripts/fetch-tools.sh` und `fetch-tools.ps1` laden portable
  Werkzeuge in das Arbeitsverzeichnis und prüfen jede Datei gegen die vom
  Projekt veröffentlichte SHA-256-Prüfsumme (GitHub-Release-API-Feld `digest`
  oder Checksum-Datei). Ohne veröffentlichte Prüfsumme gilt
  Trust-on-First-Use über `tools/lock.tsv`, und der Download braucht
  ausdrücklich `--allow-unpinned`.
- **FR-8**: Eine AIOS-Persona `forensic_analyst` (VESTIGE) und sechs Patterns
  `forensic-investigate`, `forensic-analyze`, `forensic-timeline`,
  `forensic-memory`, `forensic-enrich`, `forensic-report` machen denselben
  Ablauf über `aios run` und den MCP-Server verfügbar.
- **FR-9**: `aios init --template <name>` richtet ein Arbeitsverzeichnis aus
  einer Vorlage ein. `aios init --list-templates` listet die Vorlagen. Die
  Vorlage `forensics` legt `.aios/context.yaml`, `CLAUDE.md`, `AGENTS.md`,
  `.gitignore`, `.env`, `cases/`, `tools/` an und verlinkt den Skill in die
  AIOS-Installation, damit `aios update` ihn mitzieht.
- **FR-10**: Der Bericht enthält eine Ampel (ROT/GELB/GRÜN), eine
  Befundtabelle mit Beleg und Evidenzlabel, eine Zeitachse in UTC, eine
  **Abdeckungstabelle** und Massnahmen-Vorschläge.
- **FR-11**: `scripts/selftest.sh` legt vier harmlose Testfunde an
  (EICAR-Testdatei, ausführbare Datei in einem Temp-Pfad, Dateiname mit
  Steuerzeichen, versteckte ausführbare Datei im Home) und benennt die
  Erwartung. Es verändert keine Autostarts, Dienste oder Registry-Schlüssel.

## Nicht-funktionale Anforderungen

- **NFR-1 (Beweiswert)**: Jede gesicherte Datei steht mit SHA-256 im Manifest.
  Dateinamen mit Tabulator oder Zeilenumbruch — bei Malware üblich — werden
  bash-gequotet und mit `Q:` markiert, damit ein präparierter Name die Spalten
  der TSV-Ausgaben nicht zerstört.
- **NFR-2 (Keine Zugangsdaten im Fallordner)**: Umgebungsvariablen werden nach
  Namensmuster und nach Zugangsdaten in URLs redigiert. Von `/etc/shadow`
  werden nur Metadaten gesichert, nicht die Hashes. Shell-Historien werden
  nur nach Grösse und Zeilenzahl erfasst.
- **NFR-3 (Datenschutz nach aussen)**: Nach aussen gehen ausschliesslich
  Hashes, nie Dateien, nie Pfade mit Nutzernamen, nie Hostnamen oder
  Logauszüge. Vor der ersten Abfrage wird gefragt. Die Vorlage setzt
  `default_provider: ollama`, damit die Rohdaten lokal bleiben.
- **NFR-4 (Ehrlichkeit)**: Ein „GRÜN“ ist nur zulässig, wenn die
  Abdeckungstabelle keine relevante Lücke zeigt. Im Zweifel zwischen Gelb und
  Rot gilt Gelb mit benannter offener Frage. Die Ampel stützt sich nur auf
  `E1`/`E2`-Belege.
- **NFR-5 (Robustheit)**: Eine fehlende Quelle bricht die Sammlung nicht ab;
  sie wird als Lücke protokolliert. Fehlende Werkzeuge sind kein Fehler.
- **NFR-6 (Portabilität)**: Die Shell-Skripte sind bash-3.2-kompatibel
  (macOS liefert bash 3.2) und nutzen nur Bordmittel. Die PowerShell-Skripte
  laufen unter `Set-StrictMode -Version Latest` und fangen jede Sonde
  einzeln ab.
- **NFR-7 (Lieferkette)**: Werkzeug-Quellen sind ausschliesslich offizielle
  Projekt-Releases über HTTPS. Archive werden vor dem Entpacken auf Einträge
  mit `..` oder absolutem Pfad geprüft. Versionen sind in
  `tools.catalog.tsv` gepinnt.
- **NFR-8 (Konvention)**: Logging auf stderr, Ergebnis auf stdout
  (Unix-Konvention, CLAUDE.md).
- **NFR-9 (Kernel/User Space)**: `aios init --template` ist reiner
  Mechanismus im Kernel-Umfeld (`src/init/template.ts`) — Vorlagen-Inhalte
  liegen im User Space unter `templates/workspaces/`.

## Akzeptanzkriterien

1. `aios init --list-templates` zeigt `forensics`.
2. In einem leeren Verzeichnis erzeugt `aios init --template forensics` die
   Struktur aus FR-9; `.claude/skills/host-forensics` ist ein Symlink in die
   AIOS-Installation und der Skill ist darüber erreichbar.
3. Ein zweiter Lauf überschreibt nichts und meldet die vorhandenen Dateien.
4. `aios init --template` im AIOS-Verzeichnis selbst bricht mit einer
   erklärenden Meldung ab.
5. `detect.sh --json` liefert auf Linux und macOS valides JSON mit
   `limitations`; `detect.ps1 -Json` tut dasselbe auf Windows.
6. `collect.sh` erzeugt Fallordner, Manifest, Protokoll und `summary.txt` mit
   den drei getrennten Listen; ein fehlendes Bordmittel erscheint als Lücke
   und beendet den Lauf nicht.
7. `fetch-tools.sh --install uac` prüft gegen die veröffentlichte
   `.sha256`-Datei; `--verify` erkennt eine nachträglich veränderte Datei und
   endet mit Exit-Code 1; ein abweichender Download endet mit Exit-Code 2.
8. `selftest.sh` legt die vier Testfunde an, und eine anschliessende Sammlung
   weist alle vier nach.
9. Die Persona `forensic_analyst` erfüllt das Base Trait Protocol
   (`src/core/personas.traits.test.ts`), die sechs Patterns laden mit
   `kernel_abi: 2`.
10. `npm test` und `npm run typecheck` sind grün.

## Out of Scope

- **Beseitigung.** Kein Entfernen, keine Quarantäne, kein Beenden von
  Prozessen. Bewusst: siehe Kontext.
- **Datenträger-Abbilder.** Der Skill arbeitet am laufenden System oder an
  einem gesicherten Fallordner. Ein forensisches Voll-Abbild (`dd`, write
  blocker) ist eine andere Disziplin.
- **Netzwerk-Forensik.** Kein Mitschneiden von Verkehr, keine
  IDS-Auswertung. Nur die Verbindungen, die der Host selbst kennt.
- **Mehrere Rechner.** Ein Fall ist ein Rechner. Flottenweite Auswertung
  wäre eine EDR-Aufgabe.
- **Speicherabbild unter macOS.** Es gibt kein gepflegtes freies Werkzeug;
  SIP verhindert den Kernel-Zugriff. Wird als Lücke ausgewiesen.
- **Kommerzielle Forensik-Pakete.** Der Fallordner mit Manifest ist ein
  brauchbarer Ausgangspunkt, die Anbindung ist nicht Teil des Skills.

## Quellen

- GitHub Docs — Create skills for Copilot CLI:
  <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills>
- Velociraptor — collector command:
  <https://docs.velociraptor.app/docs/cli/collector>
- RFC 3227 — Guidelines for Evidence Collection and Archiving:
  <https://www.rfc-editor.org/rfc/rfc3227>
