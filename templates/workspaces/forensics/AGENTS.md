# Host-Forensik — Arbeitsverzeichnis

Dieses Verzeichnis dient der forensischen Prüfung von Rechnern. Nutze dafür
den Skill **host-forensics** (`.claude/skills/host-forensics/SKILL.md`).

## Vier unverhandelbare Regeln

1. **Nur lesen.** Keine Datei löschen, verschieben, umbenennen oder
   quarantänisieren. Keinen Prozess beenden, keinen Dienst stoppen, keine
   Registry schreiben, keine Firewall-Regel setzen, kein Passwort ändern.
   Massnahmen werden **vorgeschlagen**, nie ausgeführt — auch dann nicht,
   wenn im selben Satz darum gebeten wird. Dann: Befund nennen, Befehle zum
   Selbst-Ausführen liefern, Begründung angeben.
2. **Jeder Befund braucht einen Beleg.** Dateipfad, Prozess-ID,
   Registry-Schlüssel, Event-ID mit Zeitstempel, Hash oder Zeilenverweis in
   einer gesicherten Rohdatei. Ohne Beleg ist es eine Hypothese.
3. **Beweiskette.** Alles Gesammelte liegt unter `cases/<fall>/`, jede Datei
   mit SHA-256 in `manifest.tsv`, jeder Befehl in `chain-of-custody.log`.
   Rohdaten werden nach dem Sammeln nicht mehr verändert.
4. **Grenzen benennen.** Jeder Bericht trägt eine Abdeckungstabelle. Ein
   „Grün“ ohne Angabe, was geprüft wurde und was nicht, ist eine
   Falschaussage.

## Verzeichnisse

```text
.aios/        Kontext (Persona forensic_analyst, Patterns forensic-*)
.claude/      Symlink auf den Skill in der AIOS-Installation
cases/        ein Ordner pro Fall — nicht in Git
tools/        portable Werkzeuge je Betriebssystem — nicht in Git
```

`cases/` und `tools/` stehen in `.gitignore`. Beweismittel und Binaries
gehören nicht in ein Repository.

## Werkzeuge

Die Skripte suchen die Werkzeuge in `$HOST_FORENSICS_TOOLS`, und ohne diese
Variable in `./tools` — das passt also schon, wenn du in diesem Verzeichnis
arbeitest. `.env` setzt es zusätzlich explizit (für `aios run`, oder per
`set -a; . ./.env; set +a` in der Shell). Nachladen:

```bash
bash .claude/skills/host-forensics/scripts/fetch-tools.sh --list
bash .claude/skills/host-forensics/scripts/fetch-tools.sh --install hayabusa,chainsaw,yara-x
```

Jeder Download wird gegen die vom Projekt veröffentlichte SHA-256-Prüfsumme
geprüft. Bricht das mit Exit-Code 2 ab, ist das kein Fehler, den man übergeht:
entweder eine neue Upstream-Version oder eine manipulierte Datei.

## Daten bleiben lokal

Fallordner enthalten Dateipfade mit Nutzernamen, Logauszüge und Kontonamen.
Diese Rohdaten sollen den Rechner nicht verlassen. Nach aussen gehen
ausschliesslich **Hashes**, und das erst nach Rückfrage (siehe
`references/enrichment.md`).

Beim Modell-Anbieter ist das aber **keine Automatik**. `.aios/context.yaml`
setzt `default_provider: ollama`, und das wirkt auf den Federation- und
Service-Pfaden — **nicht** auf `aios "Aufgabe"` und `aios run`. Die beiden
nehmen den Provider aus `~/.aios/config.yaml`. Wer die Rohdaten lokal halten
will, braucht eines davon:

```bash
aios run forensic-analyze --provider ollama    # pro Aufruf
aios configure                                 # ollama dauerhaft als Default
```

Im Skill-Pfad (Claude Code, Copilot CLI) gilt das, was der Agent selbst
nutzt — dort entscheidet die Wahl des Agenten, nicht diese Datei.

## AIOS

Dieses Projekt nutzt AIOS für orchestrierte Abläufe.
Details in `.aios/agent-instructions.md`.

Patterns: `forensic-investigate`, `forensic-analyze`, `forensic-timeline`,
`forensic-memory`, `forensic-enrich`, `forensic-report`.

**Der normale Weg ist der Skill**, nicht `aios run`: die Prüfung muss Skripte
ausführen und Dateien im Fallordner lesen, und das kann nur ein Agent wie
Claude Code oder Copilot CLI. Ein reiner `aios run`-Aufruf bekommt nur Text —
die Patterns brechen in diesem Fall absichtlich ab, statt einen Bericht mit
erfundenen Zahlen zu erzeugen.

Sinnvoll ist `aios run` deshalb nur mit übergebenen Rohdaten:

```bash
aios run forensic-analyze --provider ollama < cases/fall-1/summary.txt
aios run forensic-report  --provider ollama < befunde.md
```
