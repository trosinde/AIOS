# Windows — Bordmittel, Autostart-Orte, Event-IDs

## Autostart-Orte, nach Häufigkeit in echten Fällen

| Ort | Prüfen mit | Hinweis |
| --- | --- | --- |
| `HKLM\…\CurrentVersion\Run`, `RunOnce` und die HKCU-Gegenstücke | `persistence/registry-run-keys.csv` | Häufigster Ort. Verdächtig: Pfade in `%TEMP%`, `%APPDATA%`, `C:\Users\Public`, PowerShell mit `-enc`/`-w hidden`. |
| Geplante Aufgaben | `persistence/scheduled-tasks.csv` | Auf `Author` achten: leer oder ein Nutzername statt eines Herstellers ist auffällig. Trigger „bei Anmeldung“ plus Pfad im Nutzerprofil ist ein starker Hinweis. |
| Dienste | `persistence/services.csv`, `services-suspicious.csv` | Verdächtig: `StartName` = LocalSystem bei einem Binary im Nutzerprofil; unquotierte Pfade mit Leerzeichen (Rechteausweitung). |
| Startup-Ordner | `persistence/startup-folders.csv` | `C:\ProgramData\…\Start Menu\Programs\StartUp` und je Nutzer unter `AppData\Roaming`. |
| WMI-Event-Abonnements | `persistence/wmi-event-*.csv` | Persistenz **ohne Datei auf der Platte**. Ein `__FilterToConsumerBinding` mit einem `ActiveScriptEventConsumer` oder `CommandLineEventConsumer` ist fast nie legitim. |
| `Winlogon` (`Shell`, `Userinit`) | `persistence/registry-winlogon.txt` | Soll `explorer.exe` bzw. `userinit.exe` sein. Alles andere ist ein Befund. |
| Image File Execution Options mit `Debugger` | `persistence/registry-ifeo.csv` | Hängt einen fremden Prozess an den Start eines Programms. Legitim fast nur bei Entwickler-Werkzeugen. |
| `AppInit_DLLs` | `persistence/registry-appinit.txt` | Veraltet, bei aktiviertem Secure Boot wirkungslos — ein Eintrag bleibt trotzdem erklärungsbedürftig. |
| LSA-Pakete | `persistence/registry-lsa.txt` | Fremde `Security Packages` / `Notification Packages` bedeuten Zugriff auf Anmeldedaten. |
| Druck-Monitore | `persistence/registry-print-monitors.csv` | Lädt eine DLL in den Spooler-Dienst (SYSTEM). |
| BITS-Jobs | `persistence/bits-jobs.csv` | Langlebige Download-Jobs als Nachlade-Mechanismus. |
| COM-Hijacking (`TreatAs`, `InprocServer32` unter HKCU) | von Autoruns erfasst | Von den Einzelabfragen nicht vollständig abgedeckt — hier hilft `autorunsc64.exe`. |

## Event-IDs, die in der Triage zuerst zählen

### Security

| ID | Bedeutung | Worauf achten |
| --- | --- | --- |
| **1102** | Security-Log wurde gelöscht | Fast immer ein Befund. Wer löscht, verdeckt etwas. Ausnahme: dokumentierte Wartung. |
| **4624** | Anmeldung erfolgreich | `LogonType` entscheidet: 2 = lokal, 3 = Netzwerk, 7 = Entsperren, 10 = RDP. Typ 10 von einer unbekannten Quell-IP ist ein Einstiegspunkt. |
| **4625** | Anmeldung fehlgeschlagen | Viele in kurzer Zeit = Brute Force. Ein einzelner Fehlschlag kurz vor einem erfolgreichen 4624 ist interessanter als 10 000 Fehlschläge ohne Erfolg. |
| **4648** | Anmeldung mit explizit angegebenen Zugangsdaten | Typisch für Lateral Movement (`runas`, `PsExec`). |
| **4672** | Anmeldung mit besonderen Rechten | Pro Admin-Anmeldung einer. Für ein Dienstkonto, das keine Admin-Rechte haben soll: Befund. |
| **4688** | Prozess erstellt | Die wichtigste ID für die Prozess-Historie — **nur wenn die Kommandozeile mitprotokolliert wird** (siehe unten). |
| **4698 / 4699 / 4700 / 4702** | Geplante Aufgabe erstellt / gelöscht / aktiviert / geändert | Die Aufgabendefinition steht im XML des Events, auch wenn die Aufgabe längst gelöscht ist. |
| **4719** | Audit-Richtlinie geändert | Protokollierung abschalten ist ein Vorbereitungsschritt. |
| **4720 / 4722 / 4724** | Konto erstellt / aktiviert / Passwort zurückgesetzt | Unerklärte neue Konten sind ein Rot-Kandidat. |
| **4728 / 4732 / 4756** | Mitglied zu einer privilegierten Gruppe hinzugefügt | 4732 mit der SID `S-1-5-32-544` = lokale Administratoren. |
| **4738** | Konto geändert | Zusammen mit 4724 die Spur eines übernommenen Kontos. |
| **4776** | NTLM-Anmeldeprüfung | Quell-Workstation-Name verrät das angreifende Gerät. |
| **5140 / 5145** | Netzwerkfreigabe zugegriffen | `ADMIN$`, `C$`, `IPC$` deuten auf Lateral Movement. |

### System

| ID | Bedeutung |
| --- | --- |
| **7045** | Neuer Dienst installiert — klassische Spur von PsExec-artigen Werkzeugen |
| **7034 / 7035 / 7036** | Dienst abgestürzt / Steuerbefehl / Statuswechsel. Ein abgestürzter Virenscanner-Dienst ist erklärungsbedürftig. |
| **6005 / 6006** | Eventlog gestartet / gestoppt — markiert Start und geordnetes Herunterfahren |
| **6008** | Vorheriges Herunterfahren war unerwartet |
| **1074** | Herunterfahren angefordert, mit Prozess und Grund |
| **104** | Eventlog wurde gelöscht (Gegenstück zu Security 1102 für andere Logs) |

### Weitere Logs

| Log | Interessant |
| --- | --- |
| `Microsoft-Windows-Sysmon/Operational` | 1 = Prozessstart mit Hash und Kommandozeile, 3 = Netzwerkverbindung, 7 = Image geladen, 8 = Remote-Thread, 11 = Datei erstellt, 12–14 = Registry, 22 = DNS-Abfrage. Wenn vorhanden, die beste Quelle. |
| `Microsoft-Windows-PowerShell/Operational` | **4104** = ausgeführter Script-Block im Klartext. Deobfuskiert, was in 4688 nur als Base64 steht. |
| `Microsoft-Windows-TaskScheduler/Operational` | 106 = registriert, 200/201 = Aktion gestartet/beendet |
| `Microsoft-Windows-Windows Defender/Operational` | 1116/1117 = Erkennung/Reaktion, **5001** = Echtzeitschutz abgeschaltet, 5007 = Konfiguration geändert |
| `Microsoft-Windows-TerminalServices-*` | RDP-Sitzungen mit Quell-IP |
| `Microsoft-Windows-WMI-Activity/Operational` | 5857–5861 = WMI-Konsumenten, zu den Abonnements oben |
| `Microsoft-Windows-Bits-Client/Operational` | 59/60 = Download-Jobs |

## Abdeckung: was es gar nicht gibt

Bevor du „nichts gefunden“ schreibst, prüfe in `detect.json` (Abschnitt
`logging`) und in `logs/auditpol.txt`:

- **`process_cmdline_auditing` = false** → 4688 ohne Kommandozeile. Du siehst,
  *dass* `powershell.exe` lief, nicht *was* es tat. Ohne Sysmon ist die
  Prozess-Historie damit praktisch wertlos.
- **`powershell_scriptblock_logging` = false** → keine 4104-Events. Ausgeführte
  PowerShell ist nachträglich nicht rekonstruierbar.
- **Sysmon nicht installiert** → keine Prozessstart-Historie mit Hashes.
- **Security-Log klein** (`logs/eventlog-inventory.csv`, Spalte `max_mb`) → bei
  20 MB Standardgrösse reicht die Historie auf einem aktiven Rechner oft nur
  Tage. Das Fehlen alter Ereignisse ist dann Rotation, nicht Manipulation.
- **Defender-Ausnahmen** (`logs/defender-preferences.txt`) → was in
  `ExclusionPath` / `ExclusionProcess` steht, wurde nie gescannt. Angreifer
  tragen dort gern ihr Arbeitsverzeichnis ein. Eine Ausnahme auf `C:\` oder auf
  einen Nutzerordner ist selbst ein Befund.

## Gesperrte Artefakte

Diese Dateien sind im laufenden Betrieb nicht einfach kopierbar:

| Artefakt | Pfad | Weg |
| --- | --- | --- |
| Eventlogs | `%SystemRoot%\System32\winevt\Logs\*.evtx` | `wevtutil epl <Logname> <Ziel>` — macht `collect.ps1` |
| Registry-Hives | `%SystemRoot%\System32\config\{SYSTEM,SOFTWARE,SAM,SECURITY}` | `reg save HKLM\SYSTEM <Ziel>` (Admin) — `collect.ps1 -Mode collect` |
| Nutzer-Hive | `C:\Users\<name>\NTUSER.DAT` | Velociraptor, oder `reg save HKU\<SID>` für den angemeldeten Nutzer |
| Amcache | `%SystemRoot%\AppCompat\Programs\Amcache.hve` | Velociraptor (Kopie schlägt oft fehl) |
| SRUM | `%SystemRoot%\System32\sru\SRUDB.dat` | Velociraptor |
| `$MFT`, `$UsnJrnl` | NTFS-Metadateien | Velociraptor (rohes Lesen vom Laufwerk) |
| Prefetch | `%SystemRoot%\Prefetch\*.pf` | Kopie geht meist, braucht Admin |

Velociraptor-Aufruf für die gesperrten Fälle steht in `guides.md`.

## Bekannte Falschalarme

- **`svchost.exe`, `rundll32.exe`, `regsvr32.exe`, `mshta.exe`** sind
  legitime Windows-Programme. Verdächtig ist nicht der Name, sondern der
  Elternprozess und die Kommandozeile: `winword.exe` → `powershell.exe` ist
  auffällig, `services.exe` → `svchost.exe -k netsvcs` ist normal.
- **Unsignierte Binaries in `System32`** gibt es auch legitim (Treiber-Reste,
  alte Komponenten). Erst in Verbindung mit einem jungen mtime relevant.
- **Geplante Aufgaben von Herstellern** (Google Update, Adobe, Dell) sind
  zahlreich und laufen oft aus `ProgramData`. Signatur prüfen, nicht nur den
  Pfad.
- **Hersteller-Telemetrie** erzeugt viele ausgehende Verbindungen. Die Domain
  entscheidet, nicht die Menge.
- **`MpPreference`-Ausnahmen von der IT** sind legitim, wenn sie dokumentiert
  sind. Nachfragen, nicht annehmen.
