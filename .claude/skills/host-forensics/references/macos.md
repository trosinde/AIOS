# macOS — Bordmittel, Autostart-Orte, Logs

## Autostart-Orte, nach Häufigkeit in echten Fällen

| Ort | Prüfen mit | Hinweis |
| --- | --- | --- |
| `~/Library/LaunchAgents` | `persistence/launch-plists.txt` | Braucht keine Admin-Rechte und ist deshalb der häufigste Ort für Adware und Infostealer. |
| `/Library/LaunchAgents` | dito | Systemweit, pro Nutzersitzung. |
| `/Library/LaunchDaemons` | dito | Läuft als root, unabhängig von der Anmeldung. Der stärkste Persistenz-Ort. |
| `/System/Library/Launch*` | `persistence/launch-dirs.txt` | Durch SIP geschützt. Ein fremder Eintrag hier bedeutet, dass SIP umgangen wurde — äusserst selten und dann ein Rot-Befund. |
| Login Items | `persistence/login-items.txt` | Auch als „Anmeldeobjekte“ in den Systemeinstellungen sichtbar. |
| Konfigurationsprofile | `persistence/config-profiles.txt` | `profiles -P`. Ein unerwartetes MDM-Profil kann Einstellungen erzwingen und Software installieren. |
| cron | `persistence/cron-user.txt` | Auf macOS veraltet, funktioniert aber. |
| `/etc/periodic/` | `persistence/periodic.txt` | Tages-/Wochen-/Monatsskripte. |
| `emond` | `persistence/emond.txt` | Event-Monitor-Daemon; in neueren macOS-Versionen entfernt, auf älteren ein beliebter, unauffälliger Ort. |
| Kernel-Extensions | `volatile/kextstat.txt`, `persistence/kext-dirs.txt` | Auf aktuellen Systemen weitgehend durch System-Extensions ersetzt. Ein nicht von Apple signiertes kext ist auffällig. |
| System-Extensions | `volatile/systemextensions.txt` | Der moderne Weg. Netzwerk-Extensions können den gesamten Verkehr umleiten. |
| Shell-Startdateien | `persistence/shell-rc.txt` | `~/.zshrc` ist der Standard seit Catalina. |

## Die wertvollsten Einzelprüfungen

**SIP-Status.** `logs/csrutil-status.txt`. „System Integrity Protection
status: enabled“ ist der Normalzustand. Ist SIP aus, ist jede weitere
Feststellung schwächer — und das Abschalten selbst erfordert einen Neustart in
den Recovery-Modus, also physischen Zugang oder jemanden, der es bewusst getan
hat. Immer in die Abdeckungstabelle.

**Gatekeeper.** `logs/spctl-assess.txt`. „assessments disabled“ heisst, dass
unsignierte Programme ohne Rückfrage starten.

**Signaturen von Programmen.** `filesystem/unsigned-apps.tsv` ruft
`codesign -dv` für jedes `.app` auf. Interessant ist nicht „unsigniert“ allein,
sondern die Kombination aus unsigniert, jungem Datum und einem Ort ausserhalb
von `/Applications`.

Gezielt nachprüfen:

```bash
codesign -dvvv --verbose=4 /Applications/Verdaechtig.app 2>&1
spctl --assess --verbose=4 /Applications/Verdaechtig.app 2>&1
# Notarisierung:
spctl -a -vvv -t install /Applications/Verdaechtig.app 2>&1
```

**Quarantäne-Datenbank.** `filesystem/quarantine-events.txt` listet nur die
Metadaten der Datei. Der Inhalt sagt, **woher** eine heruntergeladene Datei
kam — oft die Antwort auf „wie kam das auf den Rechner“:

```bash
sqlite3 "$HOME/Library/Preferences/com.apple.LaunchServices.QuarantineEventsV2" \
  "select datetime(LSQuarantineTimeStamp + 978307200, 'unixepoch'),
          LSQuarantineAgentName, LSQuarantineDataURLString
   from LSQuarantineEvent order by LSQuarantineTimeStamp desc limit 50;"
```

Der Offset 978307200 rechnet Apples Referenzdatum (2001-01-01) auf Unix-Zeit um.

**TCC (Datenschutz-Berechtigungen).** `accounts/tcc-db-metadata.txt`. Die
Datenbank selbst ist durch SIP geschützt und nur mit „Full Disk Access“ lesbar.
Wer dort Bildschirmaufnahme oder Eingabeüberwachung für ein unbekanntes
Programm findet, hat einen Befund. Praktisch geht das über die
Systemeinstellungen → Datenschutz & Sicherheit.

## Logs

Das Unified Log ersetzt die klassischen Textlogs. Es ist gross und die
Abfrage ist teuer — deshalb immer mit Zeitfenster **und** Prädikat.

```bash
# Anmeldungen und Rechteausweitung
log show --style syslog --last 7d \
  --predicate 'process == "sudo" OR process == "sshd" OR process == "loginwindow"'

# Installationen
log show --style syslog --last 30d \
  --predicate 'process == "installd" OR process == "softwareupdated"'

# launchd-Aktivität (neue Agents/Daemons)
log show --style syslog --last 7d --predicate 'process == "launchd"'

# XProtect-Erkennungen
log show --style syslog --last 30d --predicate 'subsystem == "com.apple.xprotect"'
```

**Grenze:** Das Unified Log hält je nach Plattenbelegung oft nur Tage bis
wenige Wochen. „Kein Eintrag“ heisst häufig „schon rotiert“, nicht „nicht
passiert“. Das gehört in die Abdeckungstabelle.

Weitere Quellen:

| Quelle | Datei im Fall |
| --- | --- |
| Installationshistorie | `logs/install-history.txt` |
| FileVault-Status | `logs/fdesetup-status.txt` |
| Verzeichnis `/var/log`, `/Library/Logs` | `logs/system-log-dir.txt` |

## Konten

`accounts/dscl-users.txt` und `accounts/dscl-admin-group.txt`. macOS führt
Konten über Directory Services, nicht nur über `/etc/passwd` — `dscl` ist
deshalb die verlässliche Quelle. Ein Konto in der Gruppe `admin`, das niemand
kennt, ist ein Rot-Kandidat.

Versteckte Konten (UID < 500 oder `IsHidden`) prüfen:

```bash
dscl . -list /Users UniqueID | awk '$2 < 500 { print }'
dscl . -readall /Users IsHidden 2>/dev/null | grep -B2 'IsHidden: 1'
```

## Speicherabbild

Für aktuelle macOS-Versionen gibt es kein gepflegtes freies Werkzeug für ein
vollständiges Speicherabbild — SIP verhindert den nötigen Kernel-Zugriff.
`collect.sh` vermerkt das als Lücke. Wer Speicher braucht, arbeitet mit
Prozess-Dumps einzelner verdächtiger PIDs, und das nur mit ausdrücklichem
Auftrag, weil ein Dump Zugangsdaten enthalten kann.

## Bekannte Falschalarme

- **Adware-ähnliche, aber legitime Programme**: Browser-Updater (Google,
  Microsoft), Drucker-Software und VPN-Clients legen LaunchAgents an, laufen
  unsigniert in Teilen und kontaktieren Server. Signatur und Herstellername
  prüfen.
- **`mdworker`, `mds_stores`** (Spotlight) erzeugen viel Dateizugriff und
  hohe Last. Normal.
- **Rosetta** lässt x86-Prozesse auf Apple Silicon laufen — `ps` zeigt dann
  Architekturen gemischt. Normal.
- **`/private/var/folders/…`** ist das normale Temp-Verzeichnis pro Nutzer,
  nicht automatisch verdächtig.
- **Nicht notarisierte Entwickler-Werkzeuge** (Homebrew-Binaries, selbst
  gebaute Programme) scheitern an `spctl`, sind aber meist legitim.
