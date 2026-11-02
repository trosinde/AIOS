#!/usr/bin/env bash
#
# AIOS host-forensics — Beweissicherung für Linux und macOS.
#
# Sammelt rein lesend in einen Fallordner. Reihenfolge nach RFC 3227
# (flüchtig zuerst):
#   1. Speicherabbild (nur mit --memory)
#   2. Prozesse und Netzwerk
#   3. Autostarts
#   4. Konten
#   5. Logs
#   6. Dateien
#   7. Hashes
#
# Nichts auf dem untersuchten System wird verändert. Geschrieben wird
# ausschliesslich in den Fallordner.
#
# Verwendung:
#   collect.sh --case-dir cases/fall-1 [--mode live|collect] [--memory]
#              [--log-days N] [--extra-dir PFAD]...
#
# --mode live     schnelle Momentaufnahme, Logs begrenzt (Standard)
# --mode collect  vollständige Sicherung für spätere Auswertung
# --memory        Speicherabbild (braucht root und avml; gross und langsam)
# --log-days N    Zeitfenster für Logs (Standard: 7 bei live, 30 bei collect)
# --extra-dir D   zusätzliches Verzeichnis für die Dateiprüfung (wiederholbar)
#
# Exit-Codes: 0 = Sammlung abgeschlossen (einzelne Lücken sind normal und
# stehen in summary.txt), 1 = Abbruch vor der Sammlung.

set -uo pipefail

# CDPATH= setzt die Variable nur fuer dieses cd: ein gesetztes CDPATH
# wuerde sonst in ein ganz anderes Verzeichnis wechseln.
# shellcheck disable=SC1007
HF_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$HF_SCRIPT_DIR/lib.sh"

CASE_DIR=""
MODE="live"
WANT_MEMORY=1
LOG_DAYS=""
EXTRA_DIRS=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --case-dir)
      case "${2:-}" in
        -*) hf_die "--case-dir braucht einen Pfad, keine Option: ${2}" ;;
        "") hf_die "--case-dir braucht einen Pfad" ;;
      esac
      CASE_DIR="${2}"; shift 2 ;;
    --mode)      MODE="${2:-}";     shift 2 ;;
    --memory)    WANT_MEMORY=0;     shift ;;
    --log-days)  LOG_DAYS="${2:-}"; shift 2 ;;
    --extra-dir)
      # Ein mit "-" beginnender Wert waere fuer find ein Praedikat, nicht ein
      # Pfad — find haette dann keinen Pfad-Operanden und wuerde "." durchsuchen.
      # Mit "-delete" waere daraus sogar ein Loeschbefehl geworden, in einem
      # Werkzeug, dessen erste Regel "nur lesen" ist.
      case "${2:-}" in
        -*) hf_die "--extra-dir braucht einen Pfad, keine Option: ${2:-}" ;;
        "") hf_die "--extra-dir braucht einen Pfad" ;;
      esac
      EXTRA_DIRS="$EXTRA_DIRS
${2}"; shift 2 ;;
    -h|--help)   sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           hf_die "Unbekannte Option: $1" ;;
  esac
done

[ -n "$CASE_DIR" ] || hf_die "--case-dir fehlt. Beispiel: --case-dir cases/fall-$(date -u +%Y-%m-%d)"
case "$MODE" in
  live|collect) : ;;
  *) hf_die "--mode muss live oder collect sein (offline und wsl haben eigene Abläufe)" ;;
esac

if [ -z "$LOG_DAYS" ]; then
  if [ "$MODE" = "collect" ]; then LOG_DAYS=30; else LOG_DAYS=7; fi
fi
case "$LOG_DAYS" in ''|*[!0-9]*) hf_die "--log-days braucht eine Zahl" ;; esac

OS=$(hf_os)

# Pfade, in denen Malware üblicherweise landet. Ein Vollscan über das ganze
# Dateisystem gehört in die offline-Auswertung, nicht in eine Live-Sammlung.
if [ "$OS" = "darwin" ]; then
  TEMP_PATHS='/tmp /var/tmp /private/tmp /private/var/tmp'
else
  TEMP_PATHS='/tmp /var/tmp /dev/shm'
fi

case "$OS" in
  linux|darwin) : ;;
  *) hf_die "collect.sh läuft auf Linux und macOS. Für Windows: collect.ps1 (nativ) oder collect-windows.sh (aus WSL)." ;;
esac

# Unter WSL würde collect.sh nur die Linux-Seite sehen — das ist fast nie
# gemeint. Hinweis geben, aber nicht blockieren: manchmal ist genau die
# Linux-Seite der Untersuchungsgegenstand.
if hf_is_wsl; then
  hf_warn "WSL erkannt. collect.sh sichert NUR die Linux-Seite."
  hf_warn "Für das Windows darunter: collect-windows.sh im selben Fallordner."
fi

hf_log ""
hf_log "AIOS host-forensics — Sammlung ($OS, Betriebsart $MODE)"
hf_log ""

hf_case_init "$CASE_DIR" "$MODE" "$OS"

# ─── 0. Systemzustand festhalten ─────────────────────────────────────────

if [ -x "$HF_SCRIPT_DIR/detect.sh" ]; then
  "$HF_SCRIPT_DIR/detect.sh" --json --out "$HF_CASE_DIR/detect.json" 2>/dev/null \
    || hf_skip "detect.json" "Erkennung fehlgeschlagen"
else
  hf_skip "detect.json" "detect.sh nicht gefunden"
fi

hf_run host/uname.txt uname -a
hf_run host/date-utc.txt date -u
hf_run host/uptime.txt uptime
hf_run host/id.txt id
hf_env_sanitized host/env-sanitized.txt
hf_copy /etc/hostname host/hostname
hf_copy /etc/os-release host/os-release
hf_copy /etc/timezone host/timezone

# ─── 1. Speicherabbild ───────────────────────────────────────────────────

collect_memory() {
  if [ "$WANT_MEMORY" -ne 0 ]; then
    hf_skip "memory/" "nicht angefordert (--memory setzen)"
    return
  fi
  if ! hf_is_root; then
    hf_skip "memory/" "Speicherabbild braucht root"
    return
  fi
  case "$OS" in
    linux)
      avml=$(hf_tool avml 2>/dev/null) || avml=""
      if [ -z "$avml" ]; then
        hf_skip "memory/memory.lime" "avml nicht vorhanden (fetch-tools.sh --install avml)"
        return
      fi
      hf_log "  Speicherabbild läuft — das dauert und braucht Platz in Höhe des RAM."
      local rc=0
      "$avml" "$HF_CASE_DIR/memory/memory.lime" >/dev/null 2>"$HF_CASE_DIR/memory/avml.stderr" || rc=$?
      hf_coc "memory/memory.lime" "$rc" "$(hf_filesize "$HF_CASE_DIR/memory/memory.lime")" "$avml"
      [ "$rc" -eq 0 ] || hf_skip "memory/memory.lime" "avml Exit-Code $rc"
      ;;
    darwin)
      # Für aktuelle macOS-Versionen gibt es kein gepflegtes freies
      # Speicherabbild-Werkzeug; SIP verhindert den Kernel-Zugriff.
      hf_skip "memory/" "macOS: kein freies Werkzeug für ein vollständiges Speicherabbild (SIP). Ersatz: Prozess-Dumps einzelner verdächtiger PIDs mit lldb, nur mit ausdrücklichem Auftrag."
      ;;
  esac
}

# ─── 2. Prozesse und Netzwerk ────────────────────────────────────────────

collect_volatile_linux() {
  hf_run volatile/ps-auxww.txt ps auxww
  hf_run volatile/ps-forest.txt ps -eo pid,ppid,user,lstart,etime,stat,wchan:20,args --forest
  hf_run volatile/ps-threads.txt ps -eLo pid,tid,user,args
  hf_sh  volatile/proc-exe-links.txt 'ls -l /proc/[0-9]*/exe 2>/dev/null; exit 0'
  hf_sh  volatile/proc-cwd-links.txt 'ls -l /proc/[0-9]*/cwd 2>/dev/null; exit 0'
  # Prozesse, deren Binary auf der Platte nicht mehr existiert: klassisches
  # Malware-Muster (Datei laeuft, ist aber geloescht).
  hf_sh  volatile/proc-deleted-binaries.txt 'ls -l /proc/[0-9]*/exe 2>/dev/null | grep "(deleted)" || true'
  hf_sh  volatile/proc-cmdline.tsv 'for p in /proc/[0-9]*; do pid=${p#/proc/}; c=$(tr "\0" " " < "$p/cmdline" 2>/dev/null); [ -n "$c" ] && printf "%s\t%s\n" "$pid" "$c"; done'

  if hf_have_tool ss; then
    hf_run volatile/net-ss.txt ss -tunap
    hf_run volatile/net-ss-extended.txt ss -tunapie
  elif hf_have_tool netstat; then
    hf_run volatile/net-netstat.txt netstat -tunapee
  else
    hf_skip "volatile/net-*.txt" "weder ss noch netstat vorhanden — Netzwerkverbindungen bleiben ungeprüft"
  fi
  hf_sh volatile/net-listening.txt '(ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null) || true'
  hf_run volatile/net-ip-addr.txt ip -o addr
  hf_run volatile/net-ip-route.txt ip route
  hf_run volatile/net-ip-neigh.txt ip neigh
  hf_copy /etc/resolv.conf volatile/resolv.conf
  hf_copy /etc/hosts volatile/hosts
  hf_run volatile/iptables-save.txt iptables-save
  hf_run volatile/nft-ruleset.txt nft list ruleset

  hf_run volatile/lsof.txt lsof -nP
  hf_run volatile/lsof-net.txt lsof -nPi
  hf_run volatile/lsmod.txt lsmod
  hf_sh  volatile/kernel-taint.txt 'cat /proc/sys/kernel/tainted 2>/dev/null; echo "# 0 = unverändert. Siehe Documentation/admin-guide/tainted-kernels.rst"'
  hf_copy /etc/ld.so.preload volatile/ld.so.preload
  hf_sh  volatile/ld-preload-env.txt 'for p in /proc/[0-9]*; do [ -r "$p/environ" ] || continue; pid=${p#/proc/}; v=$(tr "\0" "\n" < "$p/environ" 2>/dev/null | grep -E "^LD_(PRELOAD|LIBRARY_PATH|AUDIT)=" || true); if [ -n "$v" ]; then printf "%s\t%s\n" "$pid" "$(printf "%s" "$v" | tr "\n" ";")"; fi; done; exit 0'
  hf_run volatile/mounts.txt findmnt -A
  hf_copy /proc/mounts volatile/proc-mounts
  hf_run volatile/who.txt who -a
  hf_run volatile/w.txt w
}

collect_volatile_darwin() {
  hf_run volatile/ps-auxww.txt ps auxww
  hf_run volatile/ps-forest.txt ps -eo pid,ppid,user,lstart,etime,stat,command
  hf_run volatile/lsof.txt lsof -nP
  hf_run volatile/lsof-net.txt lsof -nPi
  hf_run volatile/net-netstat.txt netstat -anv
  hf_run volatile/net-ifconfig.txt ifconfig -a
  hf_run volatile/net-route.txt netstat -rn
  hf_run volatile/net-arp.txt arp -an
  hf_run volatile/net-dns.txt scutil --dns
  hf_run volatile/net-proxy.txt scutil --proxy
  hf_copy /etc/hosts volatile/hosts
  hf_run volatile/pfctl-rules.txt pfctl -sr
  hf_run volatile/kextstat.txt kextstat
  hf_run volatile/systemextensions.txt systemextensionsctl list
  hf_run volatile/mounts.txt mount
  hf_run volatile/who.txt who -a
  hf_run volatile/sysctl-kern.txt sysctl -a
}

# ─── 3. Autostarts ───────────────────────────────────────────────────────

collect_persistence_linux() {
  hf_run persistence/systemd-units.txt systemctl list-units --all --no-pager
  hf_run persistence/systemd-unit-files.txt systemctl list-unit-files --no-pager
  hf_run persistence/systemd-timers.txt systemctl list-timers --all --no-pager
  hf_run persistence/systemd-user-units.txt systemctl --user list-units --all --no-pager
  # Units ausserhalb der Distributionspfade sind die interessanten.
  hf_sh  persistence/systemd-local-units.txt 'for d in /etc/systemd/system /etc/systemd/user /usr/local/lib/systemd/system /run/systemd/system; do if [ -d "$d" ]; then printf "===== %s =====\n" "$d"; ls -la "$d"; else printf "===== %s (nicht vorhanden) =====\n" "$d"; fi; done'
  hf_sh  persistence/systemd-unit-contents.txt 'for f in /etc/systemd/system/*.service /etc/systemd/system/*.timer /etc/systemd/system/*/*.service; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f"; printf "\n"; done 2>/dev/null'
  hf_sh  persistence/cron-system.txt 'for f in /etc/crontab /etc/cron.d/* /etc/cron.hourly/* /etc/cron.daily/* /etc/cron.weekly/* /etc/cron.monthly/*; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f"; printf "\n"; done 2>/dev/null'
  hf_sh  persistence/cron-user.txt 'for d in /var/spool/cron /var/spool/cron/crontabs; do [ -d "$d" ] || continue; for f in "$d"/*; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f"; printf "\n"; done; done 2>/dev/null'
  hf_sh  persistence/at-dirs.txt 'ls -la /var/spool/at /var/spool/cron/atjobs 2>/dev/null || true'
  hf_sh  persistence/at-jobs.txt 'atq 2>/dev/null' atq
  hf_sh  persistence/rc-scripts.txt 'for f in /etc/rc.local /etc/rc.d/rc.local /etc/init.d/*; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; head -c 20000 "$f"; printf "\n"; done 2>/dev/null'
  hf_sh  persistence/xdg-autostart.txt 'ls -la /etc/xdg/autostart/ "$HOME"/.config/autostart/ 2>/dev/null; for f in /etc/xdg/autostart/*.desktop "$HOME"/.config/autostart/*.desktop; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f"; done 2>/dev/null'
  hf_sh  persistence/shell-rc.txt 'for f in /etc/profile /etc/bash.bashrc /etc/zsh/zshrc /etc/profile.d/* "$HOME"/.bashrc "$HOME"/.bash_profile "$HOME"/.profile "$HOME"/.zshrc "$HOME"/.zshenv; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f"; printf "\n"; done 2>/dev/null'
  hf_sh  persistence/udev-rules.txt 'if [ -d /etc/udev/rules.d ]; then ls -la /etc/udev/rules.d/; else echo "(/etc/udev/rules.d nicht vorhanden)"; fi'
  hf_sh  persistence/modules-load.txt 'found=0; for f in /etc/modules /etc/modules-load.d/*; do [ -f "$f" ] || continue; found=1; printf "===== %s =====\n" "$f"; cat "$f"; done; [ "$found" -eq 1 ] || echo "(keine Modul-Ladekonfiguration vorhanden)"'
  hf_sh  persistence/dbus-services.txt 'ls -la /usr/share/dbus-1/system-services/ /etc/dbus-1/system.d/ 2>/dev/null'
  hf_sh  persistence/pam-config.txt 'ls -la /etc/pam.d/ 2>/dev/null; grep -rn "pam_exec\|pam_python" /etc/pam.d/ 2>/dev/null || true'
}

collect_persistence_darwin() {
  hf_run persistence/launchctl-list.txt launchctl list
  hf_run persistence/launchctl-print-system.txt launchctl print system
  hf_sh  persistence/launch-dirs.txt 'ls -la /Library/LaunchAgents /Library/LaunchDaemons /System/Library/LaunchAgents /System/Library/LaunchDaemons "$HOME"/Library/LaunchAgents 2>/dev/null'
  # Nur Agents/Daemons ausserhalb von /System sind realistisch manipuliert.
  hf_sh  persistence/launch-plists.txt 'for f in /Library/LaunchAgents/*.plist /Library/LaunchDaemons/*.plist "$HOME"/Library/LaunchAgents/*.plist; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; plutil -p "$f" 2>/dev/null || cat "$f"; printf "\n"; done 2>/dev/null' plutil
  hf_sh  persistence/login-items.txt 'osascript -e "tell application \"System Events\" to get the name of every login item" 2>/dev/null || true' osascript
  hf_sh  persistence/config-profiles.txt 'profiles -P 2>/dev/null' profiles
  hf_sh  persistence/periodic.txt 'ls -la /etc/periodic/*/ /etc/periodic.conf 2>/dev/null'
  hf_sh  persistence/cron-user.txt 'crontab -l 2>/dev/null || true; ls -la /usr/lib/cron/tabs 2>/dev/null || true' crontab
  hf_sh  persistence/shell-rc.txt 'for f in /etc/profile /etc/zshrc /etc/bashrc "$HOME"/.zshrc "$HOME"/.zprofile "$HOME"/.bash_profile "$HOME"/.profile; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f"; printf "\n"; done 2>/dev/null'
  hf_sh  persistence/emond.txt 'ls -la /etc/emond.d/ 2>/dev/null'
  hf_sh  persistence/kext-dirs.txt 'ls -la /Library/Extensions /System/Library/Extensions 2>/dev/null'
}

# ─── 4. Konten ───────────────────────────────────────────────────────────

collect_accounts_common() {
  hf_copy /etc/passwd accounts/passwd
  hf_copy /etc/group accounts/group
  # /etc/shadow enthaelt Passwort-Hashes: nur die Metadaten werden gesichert,
  # nicht die Hashes selbst. Sonst waere der Fallordner ein Angriffsziel.
  hf_sh accounts/shadow-metadata.tsv 'if [ -r /etc/shadow ]; then awk -F: "{printf \"%s\t%s\t%s\t%s\t%s\n\", \$1, (\$2 ~ /^[!*]/ ? \"gesperrt\" : (\$2 == \"\" ? \"LEER\" : \"gesetzt\")), \$3, \$4, \$5}" /etc/shadow; else echo "/etc/shadow nicht lesbar (root nötig)"; fi'
  hf_sh accounts/uid0-accounts.txt 'awk -F: "\$3 == 0 { print }" /etc/passwd'
  hf_sh accounts/login-shells.txt 'awk -F: "\$7 !~ /(nologin|false)\$/ { print \$1 \" -> \" \$7 }" /etc/passwd'
  hf_sh accounts/sudoers.txt 'for f in /etc/sudoers /etc/sudoers.d/*; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f" 2>/dev/null || echo "(nicht lesbar)"; printf "\n"; done 2>/dev/null'
  hf_sh accounts/ssh-authorized-keys.txt 'for d in /root /home/* /Users/*; do [ -d "$d/.ssh" ] || continue; for f in "$d"/.ssh/authorized_keys*; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f" 2>/dev/null || echo "(nicht lesbar)"; printf "\n"; done; done 2>/dev/null'
  hf_sh accounts/ssh-config.txt 'for f in /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; grep -vE "^\s*#|^\s*$" "$f" 2>/dev/null; printf "\n"; done 2>/dev/null'
  hf_run accounts/last.txt last -F
  hf_run accounts/lastb.txt lastb -F
  hf_sh  accounts/shell-history-metadata.tsv 'for f in /root/.bash_history /root/.zsh_history /home/*/.bash_history /home/*/.zsh_history /Users/*/.bash_history /Users/*/.zsh_history; do [ -f "$f" ] || continue; printf "%s\t%s Bytes\t%s Zeilen\n" "$f" "$(wc -c < "$f" 2>/dev/null)" "$(wc -l < "$f" 2>/dev/null)"; done 2>/dev/null'
}

collect_accounts_darwin() {
  hf_run accounts/dscl-users.txt dscl . -list /Users
  hf_run accounts/dscl-admin-group.txt dscl . -read /Groups/admin GroupMembership
  hf_sh  accounts/tcc-db-metadata.txt 'for f in /Library/Application\ Support/com.apple.TCC/TCC.db "$HOME"/Library/Application\ Support/com.apple.TCC/TCC.db; do [ -f "$f" ] && printf "%s\t%s Bytes\n" "$f" "$(wc -c < "$f")"; done 2>/dev/null'
}

# ─── 5. Logs ─────────────────────────────────────────────────────────────

collect_logs_linux() {
  if hf_have_tool journalctl; then
    hf_run logs/journal-since.txt journalctl --since "-${LOG_DAYS} days" --no-pager -o short-iso-precise
    hf_run logs/journal-boot-list.txt journalctl --list-boots --no-pager
    hf_run logs/journal-kernel.txt journalctl -k --since "-${LOG_DAYS} days" --no-pager -o short-iso-precise
    # Luecken im Journal sind ein eigener Befund: Rotation oder Manipulation.
    hf_run logs/journal-verify.txt journalctl --verify
  else
    hf_skip "logs/journal-*.txt" "journalctl nicht vorhanden (kein systemd)"
  fi
  hf_sh logs/auth-recent.txt "for f in /var/log/auth.log /var/log/secure; do [ -r \"\$f\" ] || continue; printf '===== %s =====\n' \"\$f\"; tail -n 50000 \"\$f\"; done 2>/dev/null"
  hf_sh logs/syslog-recent.txt "for f in /var/log/syslog /var/log/messages; do [ -r \"\$f\" ] || continue; printf '===== %s =====\n' \"\$f\"; tail -n 50000 \"\$f\"; done 2>/dev/null"
  hf_sh logs/log-dir-listing.txt 'ls -la --time-style=full-iso /var/log/ 2>/dev/null || ls -la /var/log/ 2>/dev/null'
  hf_run logs/dmesg.txt dmesg -T
  hf_run logs/auditctl-rules.txt auditctl -l
  hf_sh  logs/audit-recent.txt 'if [ -r /var/log/audit/audit.log ]; then tail -n 50000 /var/log/audit/audit.log; else echo "/var/log/audit/audit.log nicht lesbar oder auditd nicht aktiv"; fi'
  hf_sh  logs/wtmp-btmp-metadata.txt 'for f in /var/log/wtmp /var/log/btmp /var/run/utmp; do if [ -e "$f" ]; then printf "%s\t%s Bytes\n" "$f" "$(wc -c < "$f" 2>/dev/null)"; else printf "%s\tNICHT_VORHANDEN\n" "$f"; fi; done'
  if [ "$MODE" = "collect" ]; then
    hf_copy /var/log/wtmp logs/wtmp
    hf_copy /var/log/btmp logs/btmp
  fi
}

collect_logs_darwin() {
  # Die Unified-Log-Abfrage ist teuer; Zeitfenster und Prädikat begrenzen sie.
  hf_run logs/unified-log-auth.txt log show --style syslog --last "${LOG_DAYS}d" \
    --predicate 'subsystem CONTAINS "com.apple.securityd" OR process == "sudo" OR process == "sshd" OR process == "loginwindow" OR eventMessage CONTAINS "authent"'
  hf_run logs/unified-log-install.txt log show --style syslog --last "${LOG_DAYS}d" --predicate 'process == "installd" OR process == "softwareupdated"'
  hf_sh  logs/install-history.txt 'if [ -r /Library/Receipts/InstallHistory.plist ]; then plutil -p /Library/Receipts/InstallHistory.plist 2>/dev/null; else echo "InstallHistory.plist nicht lesbar"; fi' plutil
  hf_sh  logs/system-log-dir.txt 'ls -la /var/log/ /Library/Logs/ 2>/dev/null'
  hf_run logs/spctl-assess.txt spctl --status --verbose
  hf_run logs/csrutil-status.txt csrutil status
  hf_run logs/fdesetup-status.txt fdesetup status
}

# ─── 6. Dateien ──────────────────────────────────────────────────────────

collect_filesystem() {
  # Attacker-kontrollierte Dateinamen: hf_find_tsv haelt die Spalten sauber.
  for tp in $TEMP_PATHS; do
    [ -d "$tp" ] || continue
    safe=$(hf_path_slug "$tp")
    hf_find_tsv "filesystem/temp-executables-${safe}.tsv" "$tp" -xdev -type f -perm -u+x
  done
  hf_sh filesystem/temp-listing.txt "ls -laR $TEMP_PATHS 2>/dev/null | head -n 20000"
  hf_find_tsv filesystem/suid-sgid.tsv / -xdev \( -perm -4000 -o -perm -2000 \) -type f
  hf_sh filesystem/world-writable-system.tsv 'find /etc /usr/bin /usr/sbin /usr/local/bin /usr/local/sbin /bin /sbin -xdev -type f -perm -o+w 2>/dev/null | head -n 2000'
  hf_find_tsv filesystem/etc-recent-changes.tsv /etc -xdev -type f -mtime "-${LOG_DAYS}"
  for d in /root /home/* /Users/*; do
    [ -d "$d" ] || continue
    safe=$(hf_path_slug "$d")
    hf_find_tsv "filesystem/home-hidden-executables-${safe}.tsv" "$d" -xdev -maxdepth 4 -name ".*" -type f -perm -u+x
  done
  hf_sh filesystem/large-recent-files.tsv "for d in /home /Users /root /opt /srv; do [ -d \"\$d\" ] || continue; find \"\$d\" -xdev -type f -size +50M -mtime -${LOG_DAYS} 2>/dev/null; done | head -n 1000"
  hf_sh filesystem/orphaned-files.tsv 'find /etc /usr /opt -xdev \( -nouser -o -nogroup \) 2>/dev/null | head -n 1000'

  if [ "$OS" = "darwin" ]; then
    hf_sh filesystem/quarantine-events.txt 'f="$HOME/Library/Preferences/com.apple.LaunchServices.QuarantineEventsV2"; if [ -r "$f" ]; then printf "%s\t%s Bytes\n" "$f" "$(wc -c < "$f")"; else echo "QuarantineEventsV2 nicht lesbar"; fi'
    hf_sh filesystem/unsigned-apps.tsv 'for a in /Applications/*.app "$HOME"/Applications/*.app; do [ -d "$a" ] || continue; r=$(codesign -dv "$a" 2>&1 | head -3 | tr "\n" ";"); printf "%s\t%s\n" "$a" "$r"; done 2>/dev/null | head -n 500' codesign
  fi

  # Zusätzliche Verzeichnisse aus --extra-dir. Bewusst keine Pipeline:
  # in einer Subshell gingen die hf_skip-Notizen für summary.txt verloren.
  # Der Pfad geht als Argument an find, nicht in einen Shell-Schnipsel —
  # damit gibt es hier keine Injection-Stelle.
  local_ifs=$IFS
  IFS='
'
  for d in $EXTRA_DIRS; do
    [ -n "$d" ] || continue
    if [ ! -d "$d" ]; then
      hf_skip "filesystem/extra" "nicht vorhanden: $d"
      continue
    fi
    safe=$(hf_path_slug "$d")
    HF_FIND_LIMIT=20000 hf_find_tsv "filesystem/extra-${safe}.tsv" "$d" -xdev -type f
  done
  IFS=$local_ifs
}

# ─── 7. Hashes ───────────────────────────────────────────────────────────

collect_hashes() {
  if ! hf_have_sha256; then
    hf_skip "hashes/" "kein SHA-256-Werkzeug vorhanden"
    return
  fi

  if [ "$OS" = "linux" ]; then
    # Hashen über /proc/PID/exe funktioniert auch bei gelöschtem Binary —
    # genau die Fälle, die man finden will.
    hf_sh hashes/process-binaries.tsv '
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  exe=$(readlink "$p/exe" 2>/dev/null) || continue
  [ -n "$exe" ] || continue
  if [ -r "$p/exe" ]; then
    h=$(sha256sum "$p/exe" 2>/dev/null | cut -d" " -f1)
    [ -n "$h" ] || h=UNREADABLE
  else
    h=UNREADABLE
  fi
  printf "%s\t%s\t%s\n" "$pid" "$h" "$exe"
done'
  else
    hf_sh hashes/process-binaries.tsv '
ps -eo pid=,comm= 2>/dev/null | while read -r pid path; do
  case "$path" in /*) ;; *) continue ;; esac
  [ -r "$path" ] || { printf "%s\tUNREADABLE\t%s\n" "$pid" "$path"; continue; }
  h=$(shasum -a 256 -- "$path" 2>/dev/null | cut -d" " -f1)
  [ -n "$h" ] || h=UNREADABLE
  printf "%s\t%s\t%s\n" "$pid" "$h" "$path"
done'
  fi

  hf_sh hashes/temp-files.tsv "
find ${TEMP_PATHS} -xdev -type f -size -200M 2>/dev/null | head -n 2000 | while IFS= read -r f; do
  h=\$( (sha256sum -- \"\$f\" 2>/dev/null || shasum -a 256 -- \"\$f\" 2>/dev/null) | cut -d' ' -f1 )
  [ -n \"\$h\" ] || h=UNREADABLE
  printf '%s\t%s\n' \"\$h\" \"\$f\"
done"

  # Autostart-Ziele: die Binaries, die beim Booten starten.
  if [ "$OS" = "linux" ]; then
    hf_sh hashes/systemd-exec-binaries.tsv '
grep -hoE "^Exec[A-Za-z]*=.*" /etc/systemd/system/*.service /etc/systemd/system/*/*.service 2>/dev/null \
  | sed -E "s/^Exec[A-Za-z]*=[-@+!]*//" | awk "{print \$1}" | LC_ALL=C sort -u \
  | while IFS= read -r b; do
      case "$b" in /*) ;; *) continue ;; esac
      h=$(sha256sum -- "$b" 2>/dev/null | cut -d" " -f1); [ -n "$h" ] || h=UNREADABLE
      printf "%s\t%s\n" "$h" "$b"
    done'
  else
    hf_sh hashes/launch-program-binaries.tsv '
for f in /Library/LaunchAgents/*.plist /Library/LaunchDaemons/*.plist "$HOME"/Library/LaunchAgents/*.plist; do
  [ -f "$f" ] || continue
  plutil -p "$f" 2>/dev/null | grep -oE "\"/[^\"]+\"" | tr -d "\"" | LC_ALL=C sort -u | while IFS= read -r b; do
    [ -f "$b" ] || continue
    h=$(shasum -a 256 -- "$b" 2>/dev/null | cut -d" " -f1); [ -n "$h" ] || h=UNREADABLE
    printf "%s\t%s\t%s\n" "$h" "$b" "$f"
  done
done 2>/dev/null'
  fi
}

# ─── Ablauf ──────────────────────────────────────────────────────────────

hf_log "  [1/7] Speicherabbild"
collect_memory

hf_log "  [2/7] Prozesse und Netzwerk"
if [ "$OS" = "linux" ]; then collect_volatile_linux; else collect_volatile_darwin; fi

hf_log "  [3/7] Autostarts"
if [ "$OS" = "linux" ]; then collect_persistence_linux; else collect_persistence_darwin; fi

hf_log "  [4/7] Konten"
collect_accounts_common
[ "$OS" = "darwin" ] && collect_accounts_darwin

hf_log "  [5/7] Logs (Zeitfenster ${LOG_DAYS} Tage)"
if [ "$OS" = "linux" ]; then collect_logs_linux; else collect_logs_darwin; fi

hf_log "  [6/7] Dateien"
collect_filesystem

hf_log "  [7/7] Hashes"
collect_hashes

hf_log ""
hf_case_finalize "$MODE"
hf_log ""
hf_log "  Nächster Schritt: Auswertung. Die Rohdaten bleiben ab jetzt unverändert."
