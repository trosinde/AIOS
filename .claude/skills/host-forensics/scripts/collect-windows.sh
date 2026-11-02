#!/usr/bin/env bash
#
# AIOS host-forensics — Windows aus WSL heraus sichern.
#
# Startet collect.ps1 über den WSL-Interop (powershell.exe) auf der
# Windows-Seite und ergänzt eine Dateisystem-Prüfung über /mnt/c, die mit
# Linux-Werkzeugen läuft. Die Auswertung der Rohdaten passiert anschliessend
# in Linux (Hayabusa, Chainsaw, RegRipper, plaso, Volatility 3).
#
# Warum nicht einfach collect.sh? WSL 2 hat ein eigenes Netzwerk und einen
# eigenen Prozessbaum. Prozesse, Verbindungen, Dienste, Autostarts und
# Eventlogs von Windows sind von der Linux-Seite aus unsichtbar. Sie müssen
# auf der Windows-Seite erhoben werden.
#
# Verwendung:
#   collect-windows.sh --case-dir cases/fall-1 [--mode live|collect]
#                      [--memory] [--log-days N] [--skip-mnt]
#
# Voraussetzungen:
#   - WSL mit aktiviertem Interop (powershell.exe im PATH)
#   - Für vollständige Ergebnisse: Terminal als Administrator gestartet
#     (dann laufen auch die aus WSL gestarteten Windows-Programme erhöht)
#
# Exit-Codes: 0 = durchgelaufen, 1 = Abbruch vor der Sammlung.

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
SKIP_MNT=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --case-dir) CASE_DIR="${2:-}"; [ -n "$CASE_DIR" ] || hf_die "--case-dir braucht einen Pfad"; shift 2 ;;
    --mode)     MODE="${2:-}";     shift 2 ;;
    --memory)   WANT_MEMORY=0;     shift ;;
    --log-days) LOG_DAYS="${2:-}"; shift 2 ;;
    --skip-mnt) SKIP_MNT=0;        shift ;;
    -h|--help)  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          hf_die "Unbekannte Option: $1" ;;
  esac
done

[ -n "$CASE_DIR" ] || hf_die "--case-dir fehlt. Beispiel: --case-dir cases/fall-$(date -u +%Y-%m-%d)"
case "$MODE" in live|collect) : ;; *) hf_die "--mode muss live oder collect sein" ;; esac
if [ -z "$LOG_DAYS" ]; then
  if [ "$MODE" = "collect" ]; then LOG_DAYS=30; else LOG_DAYS=7; fi
fi
case "$LOG_DAYS" in ''|*[!0-9]*) hf_die "--log-days braucht eine Zahl" ;; esac

hf_is_wsl || hf_die "Dieses Skript läuft nur in WSL. Auf Windows direkt: collect.ps1. Auf Linux/macOS: collect.sh."
hf_wsl_interop || hf_die "powershell.exe ist nicht aufrufbar. WSL-Interop ist abgeschaltet (/etc/wsl.conf: interop.enabled=true) oder der PATH wird nicht übernommen (appendWindowsPath=true)."

hf_log ""
hf_log "AIOS host-forensics — Sammlung (Windows aus WSL, Betriebsart $MODE)"
hf_log ""

hf_case_init "$CASE_DIR" "$MODE" "windows-via-wsl"

# ─── Rechte prüfen, bevor gesammelt wird ─────────────────────────────────

WIN_ADMIN=$(powershell.exe -NoProfile -NonInteractive -Command \
  '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)' \
  2>/dev/null | tr -d '\r\n' | tr 'A-Z' 'a-z' || true)

if [ "$WIN_ADMIN" != "true" ]; then
  hf_warn "Die Windows-Seite läuft OHNE Administrator-Rechte."
  hf_warn "Es fehlen dann: Security-Eventlog, Registry-Hives, Prefetch, fremde Prozess-Pfade."
  hf_warn "Für eine vollständige Prüfung: Terminal als Administrator starten und erneut ausführen."
  hf_coc "host/windows-admin" "0" "0" "Windows-Admin=$WIN_ADMIN (unvollständige Abdeckung)"
else
  hf_info "Windows-Seite läuft mit Administrator-Rechten."
  hf_coc "host/windows-admin" "0" "0" "Windows-Admin=true"
fi

# ─── Pfadumsetzung: WSL-Pfad -> Windows-Pfad ─────────────────────────────
#
# collect.ps1 läuft auf der Windows-Seite und braucht den Fallordner als
# Windows-Pfad. wslpath macht genau diese Umsetzung.

if ! command -v wslpath >/dev/null 2>&1; then
  hf_die "wslpath fehlt — ohne Pfadumsetzung kann collect.ps1 den Fallordner nicht schreiben."
fi

WIN_CASE_DIR=$(wslpath -w "$HF_CASE_DIR" 2>/dev/null) \
  || hf_die "Fallordner nicht auf einen Windows-Pfad abbildbar: $HF_CASE_DIR"
WIN_SCRIPT=$(wslpath -w "$HF_SCRIPT_DIR/collect.ps1" 2>/dev/null) \
  || hf_die "collect.ps1 nicht auf einen Windows-Pfad abbildbar: $HF_SCRIPT_DIR/collect.ps1"

# Liegt der Fallordner im Linux-Dateisystem, läuft jeder Schreibzugriff von
# Windows über den 9p-Server. Das ist um Grössenordnungen langsamer und bei
# einem Speicherabbild praktisch unbrauchbar.
case "$HF_CASE_DIR" in
  /mnt/*) : ;;
  *)
    hf_warn "Der Fallordner liegt im Linux-Dateisystem ($HF_CASE_DIR)."
    hf_warn "Windows schreibt dorthin über 9p — deutlich langsamer. Bei --memory oder --mode collect"
    hf_warn "besser einen Fallordner unter /mnt/c/... verwenden."
    ;;
esac

hf_info "Fallordner (Windows-Sicht): $WIN_CASE_DIR"

# ─── 1. Windows-Seite sammeln ────────────────────────────────────────────

hf_log "  [Windows] collect.ps1 über Interop starten"

# Argumente als Array: so entsteht kein leeres Argument, wenn --memory
# fehlt, und der Fallordner-Pfad bleibt auch mit Leerzeichen intakt.
ps_args=(-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$WIN_SCRIPT"
         -CaseDir "$WIN_CASE_DIR" -Mode "$MODE" -LogDays "$LOG_DAYS")
[ "$WANT_MEMORY" -eq 0 ] && ps_args+=(-Memory)

WIN_RC=0
powershell.exe "${ps_args[@]}" \
  >"$HF_CASE_DIR/host/collect-ps1-stdout.txt" \
  2>"$HF_CASE_DIR/host/collect-ps1-stderr.txt" || WIN_RC=$?

hf_coc "host/collect-ps1-stdout.txt" "$WIN_RC" \
  "$(hf_filesize "$HF_CASE_DIR/host/collect-ps1-stdout.txt")" \
  "powershell.exe ${ps_args[*]}"

if [ "$WIN_RC" -ne 0 ]; then
  hf_warn "collect.ps1 endete mit Exit-Code $WIN_RC. Teilergebnisse sind trotzdem im Fallordner."
  hf_warn "Details: $HF_CASE_DIR/host/collect-ps1-stderr.txt"
fi

# collect.ps1 hat sein eigenes Manifest und seine eigene summary.txt in
# denselben Fallordner geschrieben. Beides wird umbenannt, damit die
# Linux-Seite am Ende ein Gesamtmanifest erzeugen kann, ohne das der
# Windows-Sammlung zu überschreiben.
for f in manifest.tsv summary.txt; do
  if [ -f "$HF_CASE_DIR/$f" ]; then
    mv -f "$HF_CASE_DIR/$f" "$HF_CASE_DIR/host/windows-$f" 2>/dev/null \
      && hf_coc "host/windows-$f" "0" "$(hf_filesize "$HF_CASE_DIR/host/windows-$f")" "umbenannt aus $f (Windows-Sammlung)"
  fi
done

# ─── 2. Dateisystem über /mnt/c prüfen ───────────────────────────────────
#
# Gesperrte Dateien (Eventlogs, Registry-Hives, $MFT) werden hier NICHT
# gelesen — dafür ist der Export aus collect.ps1 bzw. Velociraptor da.
# Über /mnt/c laufen nur Verzeichnis- und Metadaten-Prüfungen.

if [ "$SKIP_MNT" -eq 0 ]; then
  hf_skip "filesystem/mnt-c" "mit --skip-mnt abgeschaltet"
elif [ ! -d /mnt/c ]; then
  hf_skip "filesystem/mnt-c" "/mnt/c ist nicht eingebunden"
else
  hf_log "  [Linux] Dateisystem-Prüfung über /mnt/c"
  hf_warn "Scans über /mnt/c sind langsam (9p/drvfs). Es werden nur gezielte Pfade geprüft."

  WIN_USERS="/mnt/c/Users"
  hf_sh filesystem/mnt-c-root-listing.txt 'ls -la /mnt/c/ 2>/dev/null'
  hf_sh filesystem/mnt-c-programdata.txt 'ls -la "/mnt/c/ProgramData" 2>/dev/null'
  hf_sh filesystem/mnt-c-windows-temp.tsv 'find "/mnt/c/Windows/Temp" -maxdepth 3 -type f 2>/dev/null | head -n 3000'
  hf_sh filesystem/mnt-c-users-listing.txt "ls -la '$WIN_USERS' 2>/dev/null"

  # Nur die Endungen, die beim Start ausgeführt werden können.
  hf_sh filesystem/mnt-c-user-executables.tsv "
find '$WIN_USERS' -maxdepth 6 \\
  \\( -ipath '*/Downloads/*' -o -ipath '*/Desktop/*' -o -ipath '*/AppData/Local/Temp/*' -o -ipath '*/Start Menu/Programs/Startup/*' \\) \\
  -type f \\( -iname '*.exe' -o -iname '*.dll' -o -iname '*.ps1' -o -iname '*.bat' -o -iname '*.cmd' -o -iname '*.vbs' -o -iname '*.js' -o -iname '*.hta' -o -iname '*.lnk' -o -iname '*.scr' -o -iname '*.msi' \\) \\
  2>/dev/null | head -n 3000"

  hf_sh filesystem/mnt-c-startup-folders.txt "
for d in '/mnt/c/ProgramData/Microsoft/Windows/Start Menu/Programs/StartUp' '$WIN_USERS'/*/AppData/Roaming/Microsoft/Windows/Start\\ Menu/Programs/Startup; do
  [ -d \"\$d\" ] || continue
  printf '===== %s =====\n' \"\$d\"
  ls -la \"\$d\" 2>/dev/null
done"

  hf_sh filesystem/mnt-c-recent-system32.tsv "find '/mnt/c/Windows/System32' -maxdepth 1 -type f -mtime -${LOG_DAYS} 2>/dev/null | head -n 2000"
  hf_sh filesystem/mnt-c-hosts.txt 'cat "/mnt/c/Windows/System32/drivers/etc/hosts" 2>/dev/null'

  # Gesperrte Artefakte nur auflisten, nicht lesen: das Vorhandensein und die
  # Groesse sind schon eine Aussage, der Inhalt kommt aus dem Export.
  hf_sh filesystem/mnt-c-locked-artifacts.tsv '
for f in "/mnt/c/Windows/System32/config/SYSTEM" \
         "/mnt/c/Windows/System32/config/SOFTWARE" \
         "/mnt/c/Windows/System32/config/SAM" \
         "/mnt/c/Windows/System32/config/SECURITY" \
         "/mnt/c/Windows/AppCompat/Programs/Amcache.hve" \
         "/mnt/c/Windows/System32/sru/SRUDB.dat" \
         "/mnt/c/pagefile.sys" "/mnt/c/hiberfil.sys" "/mnt/c/swapfile.sys"; do
  if [ -e "$f" ]; then
    printf "%s\t%s\t%s\n" "$f" "$(wc -c < "$f" 2>/dev/null || echo GESPERRT)" "$(ls -ld -- "$f" 2>/dev/null | awk "{print \$6, \$7, \$8}")"
  else
    printf "%s\tNICHT_VORHANDEN\t\n" "$f"
  fi
done'

  hf_sh filesystem/mnt-c-prefetch-listing.tsv 'ls -la "/mnt/c/Windows/Prefetch" 2>/dev/null | head -n 2000'

  if hf_have_sha256; then
    hf_sh hashes/mnt-c-user-executables.tsv "
find '$WIN_USERS' -maxdepth 6 \\
  \\( -ipath '*/Downloads/*' -o -ipath '*/AppData/Local/Temp/*' \\) \\
  -type f \\( -iname '*.exe' -o -iname '*.dll' -o -iname '*.msi' -o -iname '*.ps1' \\) -size -200M \\
  2>/dev/null | head -n 1000 | while IFS= read -r f; do
    h=\$( (sha256sum -- \"\$f\" 2>/dev/null || shasum -a 256 -- \"\$f\" 2>/dev/null) | cut -d' ' -f1 )
    [ -n \"\$h\" ] || h=UNREADABLE
    printf '%s\t%s\n' \"\$h\" \"\$f\"
  done"
  else
    hf_skip "hashes/mnt-c-user-executables.tsv" "kein SHA-256-Werkzeug in WSL"
  fi
fi

# ─── 3. Linux-Seite selbst ───────────────────────────────────────────────
#
# Die WSL-Distribution ist Teil des Angriffsflächen-Bildes: wer Windows hat,
# kann auch hier Persistenz legen.

hf_log "  [Linux] WSL-Distribution selbst"
hf_run wsl/uname.txt uname -a
hf_sh  wsl/wsl-conf.txt 'for f in /etc/wsl.conf /etc/resolv.conf /etc/hosts; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f"; printf "\n"; done 2>/dev/null'
hf_sh  wsl/shell-rc.txt 'for f in /etc/profile /etc/bash.bashrc "$HOME"/.bashrc "$HOME"/.profile "$HOME"/.zshrc; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f"; printf "\n"; done 2>/dev/null'
hf_sh  wsl/cron.txt 'for f in /etc/crontab /etc/cron.d/*; do [ -f "$f" ] || continue; printf "===== %s =====\n" "$f"; cat "$f"; done 2>/dev/null; crontab -l 2>/dev/null || true'
hf_sh  wsl/processes.txt 'ps auxww 2>/dev/null'
hf_sh  wsl/windows-path-entries.txt 'printf "%s\n" "$PATH" | tr ":" "\n" | grep -i "^/mnt/" || true'

# ─── Abschluss ───────────────────────────────────────────────────────────

hf_log ""
hf_case_finalize "$MODE"
hf_log ""
hf_log "  Hinweis: WSL läuft auf dem untersuchten Windows. Ist Windows kompromittiert,"
hf_log "  kann es auch WSL täuschen. Bei Rot-Befund offline auf einem sauberen Rechner auswerten."
hf_log ""
hf_log "  Auswertung der Windows-Rohdaten mit Linux-Werkzeugen: references/wsl.md"
