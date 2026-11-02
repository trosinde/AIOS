# Prüfliste

Zwölf Fragen. Jede hat eine Quelle im Fallordner und, wo es passt, eine
osquery-Abfrage. Reihenfolge ist Absicht: oben steht, was am häufigsten
etwas findet.

osquery starten:

```bash
"$HOST_FORENSICS_TOOLS/bin/osqueryi" --line
# oder eine einzelne Abfrage:
"$HOST_FORENSICS_TOOLS/bin/osqueryi" --json "select * from processes limit 5;"
```

osquery liest den **laufenden** Zustand, nicht den Fallordner. Für die
Auswertung eines gesicherten Falls sind die Dateien im Fallordner die
Quelle; osquery ist das Werkzeug für die Live-Nachfrage.

---

## 1. Läuft etwas aus einem Pfad, in dem nichts laufen sollte?

**Quelle:** `hashes/process-binaries.*`, `volatile/processes-suspicious-paths.csv`

```sql
SELECT p.pid, p.name, p.path, p.cmdline, u.username
FROM processes p LEFT JOIN users u ON p.uid = u.uid
WHERE p.path LIKE '/tmp/%'      OR p.path LIKE '/var/tmp/%'
   OR p.path LIKE '/dev/shm/%'  OR p.path LIKE '%\Temp\%'
   OR p.path LIKE '%\AppData\Local\Temp\%'
   OR p.path LIKE '%\Downloads\%' OR p.path LIKE '%\Users\Public\%';
```

**Bewertung:** Treffer mit Netzwerkverbindung und Autostart-Eintrag = `E2`.
Treffer allein = `E3`, Prüfschritt benennen.

## 2. Läuft ein Prozess, dessen Datei es nicht mehr gibt?

**Quelle:** `volatile/proc-deleted-binaries.txt`, `hashes/process-binaries.tsv`
(Einträge mit `(deleted)` oder `memfd:`)

```sql
SELECT pid, name, path, cmdline FROM processes WHERE on_disk = 0;
```

**Bewertung:** Bei einem Dienstprozess nach einem Paket-Update harmlos. In
einem Nutzerkontext ein starker Hinweis — der Hash lässt sich über
`/proc/PID/exe` trotzdem bilden und anreichern.

## 3. Gibt es ausgehende Verbindungen, die niemand erklären kann?

**Quelle:** `volatile/net-tcp.csv` (Windows), `volatile/net-ss.txt` (Linux),
`volatile/net-netstat.txt` (macOS)

```sql
SELECT DISTINCT p.name, p.path, s.remote_address, s.remote_port, s.state
FROM process_open_sockets s JOIN processes p ON s.pid = p.pid
WHERE s.remote_address NOT IN ('', '0.0.0.0', '::', '127.0.0.1', '::1')
  AND s.remote_address NOT LIKE '10.%'
  AND s.remote_address NOT LIKE '192.168.%'
  AND s.remote_address NOT LIKE '172.1_.%'
  AND s.remote_address NOT LIKE 'fe80:%';
```

**Bewertung:** Ziel-IP und -Port gegen die erwartete Nutzung prüfen. Ein
Browser mit 200 Verbindungen ist normal; `svchost.exe` auf Port 4444 ist es
nicht. Reverse-DNS und Hash-Anreicherung: `enrichment.md`.

## 4. Horcht etwas auf einem Port, das nicht horchen sollte?

**Quelle:** `volatile/net-listening.txt`, `volatile/net-tcp.csv`

```sql
SELECT l.address, l.port, l.protocol, p.name, p.path
FROM listening_ports l JOIN processes p ON l.pid = p.pid
WHERE l.address NOT IN ('127.0.0.1', '::1');
```

**Bewertung:** Ein Dienst, der auf `0.0.0.0` horcht und nicht in der Liste
der gewollten Dienste steht, ist eine offene Tür — unabhängig davon, ob er
bösartig ist.

## 5. Gibt es Autostart-Einträge, die niemand angelegt hat?

**Quelle:** alles unter `persistence/`

```sql
-- Windows
SELECT name, path, source, status, username FROM startup_items;
SELECT name, path, start_type, status FROM services WHERE start_type != 'DISABLED';
SELECT name, action, path, enabled FROM scheduled_tasks WHERE enabled = 1;
-- macOS
SELECT name, path, program, run_at_load, keep_alive FROM launchd WHERE run_at_load = 1;
-- Linux
SELECT * FROM crontab;
```

**Bewertung:** Jeder Eintrag braucht einen Besitzer. „Weiss nicht“ ist `U`,
nicht „harmlos“. Signatur prüfen, nicht nur den Namen.

## 6. Gibt es Konten, die niemand kennt?

**Quelle:** `accounts/local-users.csv`, `accounts/privileged-group-members.csv`,
`accounts/uid0-accounts.txt`, `accounts/dscl-admin-group.txt`

```sql
SELECT uid, gid, username, description, directory, shell FROM users;
-- Windows: Mitglieder der lokalen Administratoren
SELECT u.username, g.groupname FROM user_groups ug
  JOIN users u ON ug.uid = u.uid JOIN groups g ON ug.gid = g.gid
WHERE g.groupname IN ('Administrators', 'admin', 'sudo', 'wheel');
```

**Bewertung:** Ein unerklärtes Konto mit Admin-Rechten oder UID 0 ist ein
Rot-Kandidat — in Verbindung mit einem passenden Erstellungs-Event (`4720`)
ist es `E2`.

## 7. Wurden Logs gelöscht oder gekürzt?

**Quelle:** `logs/security-key-events.csv` (ID 1102),
`logs/system-key-events.csv` (ID 104), `logs/journal-verify.txt`,
`logs/log-dir-listing.txt`, `accounts/last.txt`

**Bewertung:** Ein 1102-Event ohne dokumentierte Wartung ist ein Rot-Befund.
Eine `wtmp` von 0 Bytes bei wochenlanger Laufzeit ebenfalls. Fehlende alte
Einträge **ohne** solches Event sind meistens Rotation — dann sind die
Rotationsdateien da und die Log-Grösse erklärt es.

## 8. Wurde der Virenscanner geschwächt?

**Quelle:** `logs/defender-status.txt`, `logs/defender-preferences.txt`,
`detect.json` → `security_products`

**Bewertung:** Echtzeitschutz aus, Tamper Protection aus, oder eine
`ExclusionPath` auf einen Nutzerordner oder `C:\` — das ist in aller Regel
nicht die IT, sondern der Angreifer. Mit Event 5001 im Defender-Log
korrelieren, dann `E2`.

## 9. Gibt es ausführbare Dateien, wo keine sein sollten?

**Quelle:** `filesystem/temp-executables-*.tsv`,
`filesystem/user-startup-and-downloads.csv`,
`filesystem/home-hidden-executables-*.tsv`

```sql
-- Dateien in Temp-Pfaden mit Ausführungsrecht (Linux/macOS)
SELECT path, size, datetime(mtime, 'unixepoch') AS mtime_utc, mode
FROM file WHERE path LIKE '/tmp/%%' AND mode LIKE '%7%';
```

**Bewertung:** Alter und mtime sind entscheidend. Eine ausführbare Datei in
`/tmp`, erstellt in dem Zeitfenster, in dem auch etwas anderes auffällig war,
ist der Anfang einer Zeitachse.

## 10. Stimmen die Systemdateien noch?

**Quelle:** nicht Teil der Sammlung — gezielte Nachprüfung

```bash
# Debian/Ubuntu
sudo debsums -c 2>/dev/null
# RHEL/Fedora: "5" in Spalte 3 = Prüfsumme weicht ab
sudo rpm -Va --nomtime --nouser --nogroup 2>/dev/null | grep '^..5'
# Windows
sfc /verifyonly
# macOS
codesign --verify --deep --strict /Applications/Verdaechtig.app
```

**Bewertung:** Ein verändertes Systembinary (`/bin/ls`, `sshd`, `svchost.exe`)
ist ein Rot-Befund. Veränderte Konfigurationsdateien unter `/etc` sind normal.

## 11. Gibt es SUID-Dateien oder Rechte, die nicht hingehören?

**Quelle:** `filesystem/suid-sgid.tsv`, `filesystem/world-writable-system.tsv`,
`accounts/sudoers.txt`

```sql
SELECT path, uid, gid, mode FROM suid_bin;
```

**Bewertung:** Eine SUID-Shell ist der eindeutigste Linux-Befund überhaupt.
Ein `NOPASSWD: ALL` in `sudoers.d/` für ein unerwartetes Konto ebenfalls.

## 12. Wer hat sich wann angemeldet — und passt das zusammen?

**Quelle:** `logs/security-key-events.csv` (4624/4625/4648/4672),
`accounts/last.txt`, `accounts/lastb.txt`, `logs/auth-recent.txt`

```sql
SELECT username, type, tty, host, time FROM logged_in_users;
SELECT username, type, tty, host, datetime(time,'unixepoch') FROM last ORDER BY time DESC LIMIT 50;
```

**Bewertung:** Anmeldungen ausserhalb der üblichen Zeiten, von unbekannten
Quell-IPs oder mit `LogonType 10` (RDP) sind die typischen Einstiegspunkte.
Mit der Zeitachse der anderen Befunde abgleichen — das ist der Schritt, der
aus Einzelteilen einen Ablauf macht.

---

## Vor dem Bericht

Für jede der zwölf Fragen genau eine Zeile in der Abdeckungstabelle:

| Frage | Geprüft | Lücke / Grund |
| --- | --- | --- |
| 1 Prozesse aus Temp-Pfaden | ja | — |
| 7 Logs gelöscht | teilweise | Security-Log ohne Admin-Rechte nicht lesbar |
| 10 Systemdateien | nein | `debsums` nicht installiert |

„Geprüft: nein“ ist eine ehrliche Antwort. „Grün“ ohne diese Tabelle ist keine.
