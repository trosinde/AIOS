# Linux — Bordmittel, Autostart-Orte, Logs

## Autostart-Orte, nach Häufigkeit in echten Fällen

| Ort | Prüfen mit | Hinweis |
| --- | --- | --- |
| systemd-Units | `persistence/systemd-local-units.txt`, `systemd-unit-contents.txt` | Nur `/etc/systemd/system/`, `/usr/local/lib/systemd/system/` und `/run/systemd/system/` sind realistisch manipuliert — `/usr/lib/systemd/system/` gehört der Paketverwaltung. Verdächtig: `ExecStart` auf ein Binary in `/tmp`, `/dev/shm`, `/var/tmp` oder einem Home. |
| systemd-Timer | `persistence/systemd-timers.txt` | Moderner Ersatz für cron. `OnCalendar` mit kurzem Intervall plus ein Skript im Nutzerprofil ist ein Muster. |
| systemd-User-Units | `persistence/systemd-user-units.txt` | `~/.config/systemd/user/`. Läuft ohne root und wird oft übersehen. |
| cron | `persistence/cron-system.txt`, `cron-user.txt` | `/etc/crontab`, `/etc/cron.d/`, `/var/spool/cron/crontabs/<user>`. Auf `@reboot` achten. |
| `at`-Jobs | `persistence/at-jobs.txt` | Einmalige Ausführung, hinterlässt wenig Spuren. |
| Shell-Startdateien | `persistence/shell-rc.txt` | `~/.bashrc`, `~/.profile`, `~/.zshrc`, `/etc/profile.d/*`. Eine `curl … \| sh`-Zeile am Ende einer sonst normalen Datei ist das klassische Bild. |
| `/etc/ld.so.preload` | `volatile/ld.so.preload` | Lädt eine Bibliothek in **jeden** Prozess. Die Datei existiert auf den meisten Systemen gar nicht — wenn sie da ist, lies sie. |
| `LD_PRELOAD` in laufenden Prozessen | `volatile/ld-preload-env.txt` | Gleicher Mechanismus, nur pro Prozess. |
| XDG-Autostart | `persistence/xdg-autostart.txt` | Nur bei Desktop-Systemen: `/etc/xdg/autostart/`, `~/.config/autostart/`. |
| `rc.local` und init-Skripte | `persistence/rc-scripts.txt` | Auf modernen Systemen Altlast, funktioniert aber weiter. |
| Kernel-Module | `volatile/lsmod.txt`, `persistence/modules-load.txt` | Ein Modul, das zu keinem Paket gehört: `modinfo <name>` zeigt den Pfad, `dpkg -S` / `rpm -qf` den Besitzer. Kein Besitzer = Befund. |
| udev-Regeln | `persistence/udev-rules.txt` | `RUN+=` in `/etc/udev/rules.d/` startet Programme bei Geräteereignissen. |
| PAM | `persistence/pam-config.txt` | `pam_exec.so` in `/etc/pam.d/` führt bei jeder Anmeldung ein Programm aus. |
| D-Bus-Dienste | `persistence/dbus-services.txt` | `/usr/share/dbus-1/system-services/` startet Programme auf Anfrage. |
| SSH `authorized_keys` | `accounts/ssh-authorized-keys.txt` | Der häufigste dauerhafte Zugang überhaupt. Jeden Schlüssel dem Besitzer zuordnen können. |

## Die wertvollsten Einzelprüfungen

**Prozesse mit gelöschtem Binary.** `volatile/proc-deleted-binaries.txt`.
Ein laufender Prozess, dessen Datei auf der Platte nicht mehr existiert, ist
in einer normalen Umgebung fast nur nach einem Paket-Update zu erwarten (und
dann bei Dienstprozessen). Bei einem Prozess in einem Nutzerkontext ist es ein
starker Hinweis. `hashes/process-binaries.tsv` hasht über `/proc/PID/exe` und
liefert deshalb auch für gelöschte Binaries noch einen Hash — den kann man
anreichern.

**Prozesse aus Temp-Pfaden.** In `hashes/process-binaries.tsv` nach `/tmp`,
`/var/tmp`, `/dev/shm`, `/run/user` und `memfd:` suchen. `memfd:` bedeutet:
das Programm existiert nur im Speicher, nie als Datei. Legitim bei einigen
Runtimes und Sandbox-Werkzeugen, ansonsten erklärungsbedürftig.

**Kernel-Taint.** `volatile/kernel-taint.txt`. `0` heisst unverändert. Ein
gesetztes Bit für „out-of-tree module“ oder „unsigned module“ passt zu einem
geladenen Rootkit-Modul — aber auch zu einem legitimen Treiber (NVIDIA,
VirtualBox). Also als Hinweis lesen, nicht als Beweis.

**SUID/SGID-Dateien.** `filesystem/suid-sgid.tsv`. Mit der Paketverwaltung
gegenprüfen:

```bash
# Debian/Ubuntu: SUID-Dateien, die zu keinem Paket gehören
cut -f1 filesystem/suid-sgid.tsv | grep '^/' | while read -r f; do
  dpkg -S "$f" >/dev/null 2>&1 || echo "KEIN PAKET: $f"
done

# RHEL/Fedora
rpm -qf "$f" >/dev/null 2>&1 || echo "KEIN PAKET: $f"
```

Eine SUID-Shell (`/tmp/sh`, `/var/tmp/bash`) ist der eindeutigste Befund, den
es auf Linux gibt.

**Paketintegrität.** Nicht Teil der Sammlung, weil es lange dauert — aber die
stärkste Einzelprüfung, wenn der Verdacht konkret ist:

```bash
# Debian/Ubuntu
sudo debsums -c 2>/dev/null          # Paket debsums nötig
# RHEL/Fedora
sudo rpm -Va --nomtime --nouser --nogroup 2>/dev/null | grep '^..5'
```

Ein `5` in der Ausgabe von `rpm -Va` heisst: Prüfsumme der Datei weicht vom
Paket ab. Bei einem Systembinary wie `/bin/ls` oder `/usr/sbin/sshd` ist das
ein Rot-Befund. Konfigurationsdateien (`/etc/*`) weichen dagegen normal ab.

## Logs

| Quelle | Datei im Fall | Worauf achten |
| --- | --- | --- |
| journald | `logs/journal-since.txt` | `-o short-iso-precise` liefert UTC-taugliche Zeitstempel. |
| journald-Integrität | `logs/journal-verify.txt` | `journalctl --verify` meldet beschädigte Segmente. Kein Beweis für Manipulation, aber ein Prüfpunkt. |
| Boot-Liste | `logs/journal-boot-list.txt` | Eine Lücke zwischen zwei Boots deckt sich oft mit dem Zeitpunkt, an dem jemand etwas verdecken wollte. |
| `auth.log` / `secure` | `logs/auth-recent.txt` | `Failed password`, `Accepted publickey`, `sudo:` mit `COMMAND=`, `session opened for user root`. |
| `syslog` / `messages` | `logs/syslog-recent.txt` | Dienst-Neustarts, OOM-Kills, Kernel-Meldungen. |
| auditd | `logs/audit-recent.txt`, `auditctl-rules.txt` | Wenn aktiv, die genaueste Quelle. Ist die Regelliste leer, protokolliert auditd praktisch nichts — das ist eine Lücke. |
| `wtmp` / `btmp` | `accounts/last.txt`, `lastb.txt` | Binärformat. Eine auffällig kleine `wtmp` bei langer Laufzeit deutet auf Kürzung. |
| `dmesg` | `logs/dmesg.txt` | Modul-Ladevorgänge, Taint-Meldungen, USB-Geräte. |

**Lücken erkennen:** Ein Zeitsprung in `journal-since.txt` oder eine
`/var/log`-Datei mit einer mtime, die weit vor dem letzten Eintrag liegt
(`logs/log-dir-listing.txt`), ist erklärungsbedürftig. Logrotate ist die
häufigste harmlose Erklärung — dann gibt es passende `.1`/`.gz`-Dateien.

## Shell-Historien

`accounts/shell-history-metadata.tsv` listet nur Grösse und Zeilenzahl, nicht
den Inhalt. Grund: Historien enthalten regelmässig Passwörter und Tokens, und
der Fallordner soll keine Zugangsdaten sammeln.

Eine Historie mit **0 Bytes** bei einem aktiv genutzten Konto, oder ein
`~/.bash_history` als Symlink auf `/dev/null`, ist selbst ein Befund. Für den
Inhalt braucht es einen ausdrücklichen Auftrag — dann gezielt lesen und im
Bericht nur die relevanten Zeilen zitieren.

## Bekannte Falschalarme

- **Container und Snap/Flatpak** erzeugen viele Mount-Punkte, Prozesse mit
  ungewöhnlichen Pfaden (`/snap/…`, `/var/lib/docker/overlay2/…`) und eigene
  cgroup-Hierarchien. Alles normal.
- **`kworker`, `ksoftirqd`, `migration/N`** sind Kernel-Threads ohne Binary auf
  der Platte. Kein Befund.
- **Cloud-Agenten** (cloud-init, SSM, Azure Linux Agent) legen systemd-Units
  an und laden Skripte nach. Legitim, aber äusserlich einem Backdoor ähnlich.
- **Konfigurationsmanagement** (Ansible, Puppet, Chef) schreibt in `/etc` und
  erzeugt frische mtimes. `filesystem/etc-recent-changes.tsv` ist dann lang und
  harmlos.
- **`/dev/shm`** wird legitim von PostgreSQL, Chrome und vielen anderen
  genutzt. Entscheidend ist, ob dort eine **ausführbare** Datei liegt.
