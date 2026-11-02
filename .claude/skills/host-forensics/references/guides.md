# Anleitungen für die grossen Werkzeuge

Jeder Abschnitt beantwortet: wofür, wie aufrufen, was das Ergebnis wert ist.

---

## Velociraptor — gesperrte Dateien lesen

Velociraptor ist ein einzelnes Binary und braucht keinen Server. Es liest
Dateien **roh vom Laufwerk** über den NTFS-Parser und kommt damit an
Artefakte, die das laufende Windows gesperrt hält: Eventlogs,
Registry-Hives, `$MFT`, `NTUSER.DAT`, `Amcache.hve`, `SRUDB.dat`.

Dokumentation: <https://docs.velociraptor.app/docs/cli/collector>

### Offline-Collector bauen und ausführen

Der `collector`-Befehl erzeugt aus einer Spezifikation ein eigenständiges
Sammelprogramm. Die Spezifikation beschreibt, welche Artefakte gesammelt
werden und wohin das Ergebnis geht.

```yaml
# collector-spec.yaml
autoexec:
  argv: ["artifacts", "collect", "Collector"]
  artifact_definitions:
    - name: Collector
      parameters:
        - name: artifacts
          default: |
            ["Windows.KapeFiles.Targets"]
        - name: parameters
          default: |
            {"_EventLogs": "Y", "_Registry": "Y", "_FileSystem": "Y"}
        - name: target
          default: ZIP
        - name: target_args
          default: |
            {"output": "collection.zip"}
```

```powershell
# Collector erzeugen (auf einem beliebigen Rechner)
velociraptor.exe --config collector-spec.yaml config repack --exe velociraptor.exe collector.exe

# Auf dem Zielrechner als Administrator ausführen
.\collector.exe
```

Einfacher, für einen einzelnen Fall meist ausreichend — direkt sammeln:

```powershell
# Eventlogs und Registry-Hives roh lesen
velociraptor.exe -v artifacts collect Windows.KapeFiles.Targets `
  --args "_EventLogs=Y" --args "_Registry=Y" `
  --output collection.zip

# Nur die NTFS-Metadateien
velociraptor.exe -v artifacts collect Windows.NTFS.MFT --output mft.zip

# Eine einzelne gesperrte Datei herausholen
velociraptor.exe -v artifacts collect Windows.Search.FileFinder `
  --args "SearchFilesGlob=C:\Windows\AppCompat\Programs\Amcache.hve" `
  --args "Upload_File=Y" --output amcache.zip
```

Welche Artefakte es gibt:

```powershell
velociraptor.exe artifacts list | Select-String -Pattern 'Windows\.'
velociraptor.exe artifacts show Windows.KapeFiles.Targets
```

**Einordnung:** Velociraptor liest, es verändert nichts — passt also zur
Grundregel des Skills. Das Ergebnis-ZIP in den Fallordner legen und ins
Manifest aufnehmen (erneut `collect.sh`/`collect.ps1` laufen lassen oder das
ZIP vor dem Abschluss dort ablegen). Das Lesen vom Laufwerk ist genauer als
jede Kopie des laufenden Systems — aber auch langsamer.

---

## UAC — Artefakt-Sammler für Unix-artige Systeme

UAC ist reines Shell-Skript und läuft auf Linux, macOS, BSD, Solaris und AIX,
auch dort, wo kein Python und kein Compiler verfügbar ist.

```bash
bash scripts/fetch-tools.sh --install uac
UAC="$HOST_FORENSICS_TOOLS/bin/uac"

# Profile ansehen
"$UAC" --list-profiles
"$UAC" --list-artifacts

# Schnelle Triage (Minuten)
sudo "$UAC" -p ir_triage ./cases/fall-2026-11-02/uac

# Vollständig (kann Stunden dauern, viel Platz)
sudo "$UAC" -p full ./cases/fall-2026-11-02/uac
```

**Einordnung:** UAC überschneidet sich mit `collect.sh`, geht aber tiefer
(mehr Artefakttypen, mehr Distributionen) und erzeugt ein eigenes Archiv mit
eigenem Hash-Manifest. Sinnvoll, wenn der Verdacht konkret ist oder das
System exotisch. Für eine erste Einschätzung ist `collect.sh` schneller und
die Ausgabe direkt lesbar.

---

## Hayabusa — Eventlogs zu einer Timeline

```bash
HB="$HOST_FORENSICS_TOOLS/bin/hayabusa"
CASE=./cases/fall-2026-11-02

# Regeln aktualisieren (holt das Sigma-Repository)
"$HB" update-rules

# Breite Auswertung, CSV mit einer Zeile pro Treffer
"$HB" csv-timeline -d "$CASE/logs" -o "$CASE/analysis/hayabusa.csv" -p standard -U

# Nur hohe und kritische Treffer
"$HB" csv-timeline -d "$CASE/logs" -o "$CASE/analysis/hayabusa-high.csv" \
  --min-level high -U

# Überblick: welche Logs, welcher Zeitraum, wie viele Ereignisse
"$HB" eid-metrics -d "$CASE/logs"
"$HB" logon-summary -d "$CASE/logs"
```

`-U` gibt die Zeitstempel in UTC aus — ohne das rechnet Hayabusa auf die
lokale Zone um, und der Bericht wird uneinheitlich.

**Einordnung:** Hayabusa ist schnell und die Standardregeln sind gut
kuratiert. Treffer sind `E3`, bis sie durch eine zweite Quelle bestätigt sind:
Sigma-Regeln sind Heuristiken, und `logon-summary` zeigt regelmässig
Dienstkonten, die wie Brute Force aussehen.

---

## Chainsaw — gezieltes Hunting und Einzelsuche

```bash
CS="$HOST_FORENSICS_TOOLS/bin/chainsaw"
RULES="$HOST_FORENSICS_TOOLS/share/chainsaw-full"

# Regelbasiertes Hunting
"$CS" hunt "$CASE/logs" \
  -s "$RULES/sigma" \
  --mapping "$RULES/mappings/sigma-event-logs-all.yml" \
  --csv --output "$CASE/analysis/chainsaw/"

# Einzelne Event-ID ohne Regelwerk — z. B. "Log gelöscht"
"$CS" search "$CASE/logs/security.evtx" -t 'Event.System.EventID: =1102' --json

# Freitextsuche über alle Logs
"$CS" search "$CASE/logs" -e "powershell.*-enc" --json

# Shimcache und SRUM auswerten
"$CS" analyse shimcache "$CASE/registry/SYSTEM.hiv" --output shimcache.csv
"$CS" analyse srum "$CASE/filesystem/SRUDB.dat" --software "$CASE/registry/SOFTWARE.hiv"
```

Chainsaw braucht Regeln und Mappings, die nur im
`chainsaw_all_platforms+rules`-Archiv liegen, nicht im reinen Binary. Siehe
`wsl.md`, Abschnitt „Eventlogs → Timeline“.

**Einordnung:** Chainsaw ergänzt Hayabusa, es ersetzt es nicht. Stärke:
`search` für eine konkrete Frage („gab es ein 1102?“) und die
Shimcache-/SRUM-Parser. Schwäche: langsamer bei grossen Logmengen.

---

## RegRipper — Registry auswerten

```bash
git clone https://github.com/keydet89/RegRipper3.0 "$HOST_FORENSICS_TOOLS/share/regripper"
RIP="$HOST_FORENSICS_TOOLS/share/regripper/rip.pl"

perl "$RIP" -r "$CASE/registry/SYSTEM.hiv"   -f system   > "$CASE/analysis/rr-system.txt"
perl "$RIP" -r "$CASE/registry/SOFTWARE.hiv" -f software > "$CASE/analysis/rr-software.txt"
perl "$RIP" -r "$CASE/registry/SAM.hiv"      -f sam      > "$CASE/analysis/rr-sam.txt"

# Einzelne Plugins
perl "$RIP" -r "$CASE/registry/SYSTEM.hiv" -p appcompatcache
perl "$RIP" -r "$CASE/registry/SOFTWARE.hiv" -p run
perl "$RIP" -r "$CASE/registry/SYSTEM.hiv" -p services
perl "$RIP" -l | head -40   # alle Plugins
```

Nützliche Plugins: `run` (Autostarts), `services`, `tasks`,
`appcompatcache` (Shimcache: welches Programm lag wann im Dateisystem vor),
`usbstor` (angeschlossene Datenträger), `userassist` (von Nutzern gestartete
Programme), `networklist` (verbundene Netzwerke mit Zeitstempel).

**Einordnung:** Die Registry ist auf Windows die dichteste Artefaktquelle
überhaupt. `appcompatcache` und `userassist` beantworten „was wurde
ausgeführt“ auch dann, wenn die Datei längst gelöscht ist. Treffer sind `E1`,
wenn der Hive aus dem Fallordner stammt und das Manifest den Hash trägt.

---

## plaso — Super-Timeline

```bash
VENV="$HOST_FORENSICS_TOOLS/share/plaso-venv/bin"

# Alles im Fallordner einlesen
"$VENV/log2timeline.py" --storage-file "$CASE/analysis/case.plaso" "$CASE"

# Ausgeben
"$VENV/psort.py" -o dynamic -w "$CASE/analysis/timeline.csv" "$CASE/analysis/case.plaso"

# Nur ein Zeitfenster
"$VENV/psort.py" -o dynamic -w "$CASE/analysis/timeline-tag.csv" \
  "$CASE/analysis/case.plaso" \
  "date > '2026-10-28 00:00:00' AND date < '2026-10-30 00:00:00'"

# Was wurde eingelesen
"$VENV/pinfo.py" "$CASE/analysis/case.plaso"
```

**Einordnung:** plaso ist langsam (Stunden bei grossen Fällen) und erzeugt
sehr viele Zeilen. Dafür legt es Eventlogs, Registry, Prefetch,
Browser-Historien und Dateisystem-Zeiten auf **eine** Achse — der Schritt,
der aus Einzelbefunden einen Ablauf macht. Erst einsetzen, wenn ein
Zeitfenster bekannt ist; dann mit Filter statt vollständig.

---

## Volatility 3 — Speicherabbild

```bash
VOL="$HOST_FORENSICS_TOOLS/share/vol3-venv/bin/vol"
IMG="$CASE/memory/memory.raw"

# Windows
"$VOL" -f "$IMG" windows.info
"$VOL" -f "$IMG" windows.pslist
"$VOL" -f "$IMG" windows.pstree
"$VOL" -f "$IMG" windows.psscan        # findet auch beendete/versteckte Prozesse
"$VOL" -f "$IMG" windows.cmdline
"$VOL" -f "$IMG" windows.netscan
"$VOL" -f "$IMG" windows.malfind       # injizierter Code
"$VOL" -f "$IMG" windows.dlllist --pid 1234
"$VOL" -f "$IMG" windows.registry.printkey --key 'Microsoft\Windows\CurrentVersion\Run'

# Linux (braucht ein passendes Symbol-Paket, siehe Volatility-Doku)
"$VOL" -f "$CASE/memory/memory.lime" linux.pslist
"$VOL" -f "$CASE/memory/memory.lime" linux.lsmod
"$VOL" -f "$CASE/memory/memory.lime" linux.check_syscall   # Rootkit-Hinweise
```

**Der wichtigste Vergleich:** `pslist` listet Prozesse über die verkettete
Liste des Kernels, `psscan` sucht die Strukturen direkt im Speicher. Ein
Prozess, der in `psscan` auftaucht, aber nicht in `pslist`, wurde entweder
beendet oder **versteckt**. Das ist einer der wenigen direkten Rootkit-Belege.

**Einordnung:** Ein Speicherabbild ist die einzige Quelle für Dinge, die nie
auf die Platte kommen: entschlüsselte Nutzlast, injizierter Code, Sitzungs-
Token, Prozesse ohne Datei. Dafür braucht Volatility für Linux ein zum Kernel
passendes Symbol-Paket — das ist die häufigste Hürde. Für Windows gehen die
Symbole automatisch über den Microsoft-Symbolserver.

---

## osquery — Live-Nachfrage

Abfragen und Bewertung stehen in `triage-checklist.md`. Kurz:

```bash
"$HOST_FORENSICS_TOOLS/bin/osqueryi" --line
"$HOST_FORENSICS_TOOLS/bin/osqueryi" --json "select * from startup_items;"
```

**Einordnung:** osquery liest den **laufenden** Zustand, nicht den
Fallordner. Es ist das Werkzeug für die gezielte Nachfrage („horcht da wirklich
etwas auf 4444?“), nicht für die Beweissicherung. Und es unterliegt derselben
Grenze wie alle Bordmittel: ein Rootkit kann es täuschen.
