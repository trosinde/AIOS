# Windows aus WSL untersuchen

## Warum überhaupt

WSL 2 läuft in einer eigenen virtuellen Maschine mit eigenem Kernel, eigenem
Prozessbaum und eigenem Netzwerk-Stack. Von der Linux-Seite aus sind
Windows-Prozesse, -Verbindungen, -Dienste, -Autostarts und -Eventlogs
**nicht sichtbar**. `ss -tunap` in WSL zeigt die Verbindungen der
WSL-VM, nicht die von Windows.

Deshalb der Zweiteiler: **Windows sammelt, Linux wertet aus.**

```text
Windows-Host                                  WSL 2 (Linux)
┌──────────────────────────────┐              ┌──────────────────────────────────┐
│ collect.ps1 / Velociraptor   │◄─ powershell.exe (Interop) ─ Agent + Skill      │
│ Prozesse, Netz, Autostarts,  │              │                                  │
│ Eventlogs, Registry, Speicher│── Export ───►│ cases/ (Rohdaten, Manifest,      │
│                              │              │         Bericht)                 │
│ Laufwerk C:                  │              │        │ auswerten               │
│ Dateien, Prefetch, Profile   │── /mnt/c ───►│ Hayabusa, Chainsaw, RegRipper,   │
│                              │  nur lesend  │ plaso, Volatility 3, YARA-X      │
└──────────────────────────────┘              └──────────────────────────────────┘
```

## Voraussetzungen

```bash
bash scripts/detect.sh --text
```

Die Ausgabe muss zeigen: `WSL: ja, Interop verfügbar, /mnt/c eingebunden`.

- **Interop fehlt** → in `/etc/wsl.conf` steht `interop.enabled=false` oder
  `appendWindowsPath=false`. Ohne Interop ist der Live-Zustand von Windows
  nicht erreichbar.
- **Admin-Rechte.** `windows_admin` muss `true` sein. Das erreicht man, indem
  man **das Terminal als Administrator startet** — die aus WSL gestarteten
  Windows-Programme erben die erhöhten Rechte. Ein `sudo` in WSL hilft dabei
  nicht: das erhöht nur innerhalb von Linux.
- Ohne Admin fehlen: Security-Eventlog, Registry-Hives, Prefetch, Amcache,
  Pfade fremder Prozesse. Das ist eine Lücke, kein „sauber“.

## Sammeln

```bash
bash scripts/collect-windows.sh --case-dir /mnt/c/faelle/fall-2026-11-02 --mode collect
```

Der Fallordner sollte **unter `/mnt/c/…` liegen**, nicht im
Linux-Dateisystem. Schreibt Windows über den 9p-Server ins Linux-Dateisystem,
ist das um Grössenordnungen langsamer — bei einem Speicherabbild praktisch
unbrauchbar. `collect-windows.sh` warnt, wenn der Pfad im Linux-Teil liegt.

Was das Skript tut:

1. Prüft Interop und Admin-Rechte, protokolliert das Ergebnis.
2. Setzt den Fallordner mit `wslpath -w` auf einen Windows-Pfad um.
3. Startet `collect.ps1` über `powershell.exe` — das sammelt die
   Windows-Seite inklusive Eventlog-Export und (in `--mode collect`)
   Registry-Hives.
4. Benennt das Windows-Manifest in `host/windows-manifest.tsv` um, damit am
   Ende ein Gesamtmanifest über den ganzen Fallordner entsteht.
5. Prüft über `/mnt/c` gezielte Pfade mit Linux-Werkzeugen.
6. Sammelt die WSL-Distribution selbst (sie ist Teil der Angriffsfläche).

## Was über /mnt/c **nicht** geht

Diese Dateien sind im laufenden Windows gesperrt. Ein `cat` über `/mnt/c`
schlägt fehl oder liefert eine inkonsistente Kopie:

- `C:\Windows\System32\winevt\Logs\*.evtx`
- `C:\Windows\System32\config\{SYSTEM,SOFTWARE,SAM,SECURITY}`
- `C:\Users\<name>\NTUSER.DAT`
- `C:\Windows\AppCompat\Programs\Amcache.hve`
- `C:\Windows\System32\sru\SRUDB.dat`
- `$MFT`, `$UsnJrnl`, `pagefile.sys`, `hiberfil.sys`

`collect-windows.sh` listet sie nur auf (`filesystem/mnt-c-locked-artifacts.tsv`)
— Vorhandensein und Grösse sind schon eine Aussage. Den Inhalt liefert der
Export aus `collect.ps1` oder Velociraptor (siehe `guides.md`).

## Auswerten mit Linux-Werkzeugen

Alle folgenden Werkzeuge laufen in WSL und arbeiten auf den Rohdaten im
Fallordner. Nachladen mit:

```bash
bash scripts/fetch-tools.sh --install hayabusa,chainsaw,yara-x,velociraptor
```

### Eventlogs → Timeline

```bash
CASE=/mnt/c/faelle/fall-2026-11-02

# Hayabusa: breite Sigma-Auswertung, CSV-Timeline
"$HOST_FORENSICS_TOOLS/bin/hayabusa" csv-timeline \
  -d "$CASE/logs" -o "$CASE/analysis/hayabusa-timeline.csv" \
  -p standard -U

# Chainsaw: gezieltes Hunting mit mitgelieferten Regeln
"$HOST_FORENSICS_TOOLS/bin/chainsaw" hunt "$CASE/logs" \
  -s "$HOST_FORENSICS_TOOLS/share/chainsaw/sigma" \
  --mapping "$HOST_FORENSICS_TOOLS/share/chainsaw/mappings/sigma-event-logs-all.yml" \
  --csv --output "$CASE/analysis/chainsaw/"

# Chainsaw: einzelne Event-IDs ohne Regelwerk
"$HOST_FORENSICS_TOOLS/bin/chainsaw" search "$CASE/logs/security.evtx" \
  -t 'Event.System.EventID: =1102' --json
```

Chainsaw bringt Regeln und Mappings im `*_all_platforms+rules`-Archiv mit.
Der Katalog installiert das reine Binary — die Regeln holt man zusätzlich:

```bash
curl -fsSL --proto '=https' -o /tmp/cs-rules.zip \
  https://github.com/WithSecureLabs/chainsaw/releases/download/v2.17.1/chainsaw_all_platforms+rules.zip
# Prüfsumme gegen die Release-Seite vergleichen, dann:
unzip -q /tmp/cs-rules.zip -d "$HOST_FORENSICS_TOOLS/share/chainsaw-full"
```

### Registry

```bash
# Hives liegen nach "--mode collect" in cases/<fall>/registry/
perl "$HOST_FORENSICS_TOOLS/share/regripper/rip.pl" \
  -r "$CASE/registry/SYSTEM.hiv" -f system > "$CASE/analysis/regripper-system.txt"
perl "$HOST_FORENSICS_TOOLS/share/regripper/rip.pl" \
  -r "$CASE/registry/SOFTWARE.hiv" -f software > "$CASE/analysis/regripper-software.txt"
```

Interessante RegRipper-Plugins: `run`, `services`, `tasks`, `appcompatcache`
(Shimcache: welche Programme lagen wann vor), `usbstor`, `userassist`.

### Super-Timeline

```bash
VENV="$HOST_FORENSICS_TOOLS/share/plaso-venv/bin"
"$VENV/log2timeline.py" --storage-file "$CASE/analysis/case.plaso" "$CASE"
"$VENV/psort.py" -o dynamic -w "$CASE/analysis/timeline.csv" "$CASE/analysis/case.plaso"
```

plaso erkennt .evtx, Registry-Hives, Prefetch, Browser-Historien und
Dateisystem-Zeiten und legt alles auf **eine** Zeitachse. Das ist der Schritt,
der aus Einzelbefunden eine Geschichte macht.

### Speicherabbild

```bash
VOL="$HOST_FORENSICS_TOOLS/share/vol3-venv/bin/vol"
"$VOL" -f "$CASE/memory/memory.raw" windows.pslist
"$VOL" -f "$CASE/memory/memory.raw" windows.pstree
"$VOL" -f "$CASE/memory/memory.raw" windows.netscan
"$VOL" -f "$CASE/memory/memory.raw" windows.malfind
"$VOL" -f "$CASE/memory/memory.raw" windows.cmdline
```

Das Abbild selbst entsteht auf der Windows-Seite mit WinPmem
(`collect-windows.sh --memory`), die Analyse läuft in Linux.

### Dateien

```bash
# YARA-X auf gezielte Pfade — nicht auf ganz /mnt/c, das dauert Stunden
"$HOST_FORENSICS_TOOLS/bin/yr" scan --recursive \
  "$HOST_FORENSICS_TOOLS/share/yara-forge-core/packages/core/yara-rules-core.yar" \
  /mnt/c/Users/<name>/Downloads
```

## Tempo

Scans über `/mnt/c` gehen durch den 9p/drvfs-Übersetzer. Ein `find` über das
ganze Laufwerk dauert sehr lange und belastet den Rechner merklich. Deshalb:

- Gezielte Pfade statt Vollscan: `Downloads`, `Desktop`,
  `AppData\Local\Temp`, `Startup`, `C:\Windows\Temp`, `ProgramData`.
- Hash-Listen aus `hashes/*.csv` nutzen, die `collect.ps1` auf der
  Windows-Seite erzeugt hat — dort laufen Dateizugriffe nativ.
- Für echte Tiefe: Velociraptor-Collector auf der Windows-Seite, danach das
  ZIP in Linux auswerten.

## Die Grenze dieses Verfahrens

WSL läuft **auf** dem untersuchten Windows. Ein Angreifer mit Kernel- oder
Hypervisor-Rechten auf dem Host kann die WSL-VM, den Interop-Kanal und
`/mnt/c` manipulieren. Alles, was auf diesem Weg erhoben wird, ist deshalb
„mindestens“, nie „genau“.

Konsequenz: Bei einem Rot-Befund ist der nächste Schritt nicht mehr
Auswertung in WSL, sondern **Offline-Analyse auf einem sauberen Rechner** —
Datenträger-Abbild ziehen oder vom Live-System booten, dann dort auswerten.
Das gehört so in den Bericht.
