# Host-Forensik

Rein lesende Prüfung eines Rechners (Windows, macOS, Linux) auf Anzeichen
einer Kompromittierung. Beweise landen mit Prüfsummen in einem Fallordner,
das Ergebnis ist ein Bericht mit Ampel (Rot/Gelb/Grün).

**Massnahmen werden vorgeschlagen, nie ausgeführt.** Das ist Absicht: ein
vorschnelles Aufräumen vernichtet Beweise, und ein Fehlalarm würde sonst zu
einem echten Schaden führen.

## Loslegen

```bash
# Einmalig: Werkzeuge ansehen und bei Bedarf laden
bash .claude/skills/host-forensics/scripts/fetch-tools.sh --list
bash .claude/skills/host-forensics/scripts/fetch-tools.sh --install hayabusa,chainsaw,yara-x

# Agent starten
claude          # oder: copilot
```

Dann im Agenten:

> Prüf meinen Rechner auf verdächtige Aktivität.

## Was passiert

1. **Erkennen** — Betriebssystem, Rechte, vorhandene Werkzeuge, Virenscanner,
   WSL. Fehlende Rechte werden *vorher* genannt, nicht erst im Bericht.
2. **Sichern** — flüchtige Daten zuerst (RFC 3227), alles nach
   `cases/<fall>/` mit `manifest.tsv` (SHA-256) und `chain-of-custody.log`.
3. **Auswerten** — zwölf Prüffragen, Befunde mit Beleg und Evidenzlabel.
4. **Berichten** — Ampel, Zeitachse, **Abdeckungstabelle**,
   Massnahmen-Vorschläge. Der Bericht landet als `cases/<fall>/report.md`.

## Ampel

| | Bedeutung |
| --- | --- |
| **ROT** | Belegte Kompromittierung. Zuerst: Netz trennen, **nicht** herunterfahren, Passwörter von einem anderen Gerät ändern. |
| **GELB** | Auffälligkeiten ohne Beleg, **oder** eine Prüflücke, die einen Rot-Befund verdecken könnte. |
| **GRÜN** | Keine Auffälligkeit über dem Rauschen **und** keine relevante Lücke in der Abdeckung. |

Ein „Grün“ ohne Abdeckungstabelle ist eine Falschaussage — deshalb steht sie
in jedem Bericht.

## Selbsttest

Prüfen, ob die Prüfung überhaupt funktioniert:

```bash
bash .claude/skills/host-forensics/scripts/selftest.sh --dir /tmp/hf-selftest
# ... Prüfung laufen lassen, die vier erwarteten Funde kontrollieren ...
bash .claude/skills/host-forensics/scripts/selftest.sh --dir /tmp/hf-selftest --clean
```

Findet der Virenscan die dort abgelegte EICAR-Testdatei nicht, ist nicht das
System sauber, sondern die Prüfung unvollständig.

## Windows aus WSL

Läuft der Agent in WSL und soll das Windows darunter prüfen: **Terminal als
Administrator starten** (die aus WSL gestarteten Windows-Programme erben die
Rechte; `sudo` in Linux hilft dafür nicht). Dann:

```bash
bash .claude/skills/host-forensics/scripts/collect-windows.sh \
  --case-dir /mnt/c/faelle/fall-$(date -u +%F) --mode collect
```

Den Fallordner unter `/mnt/c/...` anlegen, nicht im Linux-Dateisystem —
sonst schreibt Windows über 9p und es wird sehr langsam.

Einzelheiten: `.claude/skills/host-forensics/references/wsl.md`.

## Grenzen

- Ein Rootkit kann Prozesse, Dateien und Verbindungen vor den Bordmitteln
  verbergen. Live-Ergebnisse sind „mindestens“, nie „genau“.
- WSL läuft auf dem untersuchten Windows. Ist Windows kompromittiert, kann es
  auch WSL täuschen.
- Bei einem Rot-Befund ist der nächste Schritt die Offline-Auswertung auf
  einem sauberen Rechner, nicht die weitere Analyse am betroffenen System.
