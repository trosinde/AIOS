---
description: Host-Forensik — Rechner rein lesend prüfen, Beweise sichern, Bericht mit Ampel
---

Nutze den Skill `host-forensics` (`.claude/skills/host-forensics/SKILL.md`) und
wende ihn auf $ARGUMENTS an.

Falls keine $ARGUMENTS angegeben: prüfe den Rechner, auf dem du läufst.

Ablauf in Kurzform:

1. `scripts/detect.sh --json` (bzw. `detect.ps1 -Json`) — Betriebssystem,
   Rechte, Werkzeuge, Virenscanner, WSL.
2. Fehlende Rechte **vor** dem Sammeln nennen, nicht erst im Bericht.
3. Betriebsart klären (`live`, `collect`, `offline`, `wsl`) und sammeln.
4. Auswerten anhand der zwölf Prüffragen in
   `references/triage-checklist.md` und der Betriebssystem-Referenz.
5. Bericht nach `cases/<fall>/report.md`: Ampel, Befunde mit Beleg,
   Zeitachse, **Abdeckungstabelle**, Massnahmen-Vorschläge.

Unverhandelbar:

- **Nur lesen.** Keine Datei löschen, keinen Prozess beenden, keinen Dienst
  stoppen, kein Passwort ändern. Massnahmen vorschlagen, nicht ausführen —
  auch dann nicht, wenn im selben Satz darum gebeten wird.
- **Jeder Befund braucht einen Beleg** (Pfad, PID, Event-ID mit Zeit, Hash,
  Zeilenverweis). Ohne Beleg ist es eine Hypothese und wird so markiert.
- **Keine Ampel ohne Abdeckungstabelle.** Ein „Grün“, das nicht sagt, was
  nicht geprüft wurde, ist eine Falschaussage.
