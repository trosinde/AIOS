#!/usr/bin/env bash
#
# AIOS host-forensics — Systemerkennung (Linux, macOS, WSL).
#
# Ermittelt rein lesend: Betriebssystem, Rechte, vorhandene Werkzeuge,
# Virenscanner/EDR und ob WSL läuft. Ergebnis als JSON auf stdout, Hinweise
# auf stderr. Das Ergebnis entscheidet über Betriebsart und Umfang der
# anschliessenden Sammlung.
#
# Verwendung:
#   detect.sh [--json|--text] [--out DATEI]
#
# Exit-Codes: 0 = Erkennung gelaufen. Fehlende Werkzeuge sind kein Fehler.

set -uo pipefail

# CDPATH= setzt die Variable nur fuer dieses cd: ein gesetztes CDPATH
# wuerde sonst in ein ganz anderes Verzeichnis wechseln.
# shellcheck disable=SC1007
HF_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$HF_SCRIPT_DIR/lib.sh"

FORMAT="json"
OUT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --json) FORMAT="json"; shift ;;
    --text) FORMAT="text"; shift ;;
    --out)  OUT="${2:-}"; [ -n "$OUT" ] || hf_die "--out braucht einen Pfad"; shift 2 ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) hf_die "Unbekannte Option: $1" ;;
  esac
done

# ─── Basisdaten ──────────────────────────────────────────────────────────

OS=$(hf_os)
ARCH=$(hf_arch)
KERNEL=$(uname -r 2>/dev/null || printf 'unknown')
HOSTNAME_=$(hostname 2>/dev/null || printf 'unknown')
USER_=$(id -un 2>/dev/null || printf 'unknown')
UID_=$(id -u 2>/dev/null || printf '?')

OS_NAME="unknown"
OS_VERSION="unknown"
case "$OS" in
  linux)
    if [ -r /etc/os-release ]; then
      # shellcheck disable=SC1091
      OS_NAME=$(. /etc/os-release 2>/dev/null && printf '%s' "${NAME:-unknown}")
      OS_VERSION=$(. /etc/os-release 2>/dev/null && printf '%s' "${VERSION_ID:-${VERSION:-unknown}}")
    fi
    ;;
  darwin)
    OS_NAME=$(sw_vers -productName 2>/dev/null || printf 'macOS')
    OS_VERSION=$(sw_vers -productVersion 2>/dev/null || printf 'unknown')
    ;;
esac

if hf_is_root; then IS_ROOT=0; else IS_ROOT=1; fi
if hf_has_sudo; then SUDO_NOPASSWD=0; else SUDO_NOPASSWD=1; fi

# ─── WSL ─────────────────────────────────────────────────────────────────

IS_WSL=1; WSL_INTEROP=1; WSL_MNT_C=1
WSL_WINDOWS_VERSION=""
WSL_WINDOWS_ADMIN="unknown"

if hf_is_wsl; then
  IS_WSL=0
  if hf_wsl_interop; then
    WSL_INTEROP=0
    # Kurz getaktet: ein hängendes powershell.exe darf die Erkennung nicht blockieren.
    WSL_WINDOWS_VERSION=$(powershell.exe -NoProfile -NonInteractive -Command \
      '[System.Environment]::OSVersion.Version.ToString()' 2>/dev/null | tr -d '\r\n' || true)
    WSL_WINDOWS_ADMIN=$(powershell.exe -NoProfile -NonInteractive -Command \
      '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)' \
      2>/dev/null | tr -d '\r\n' | tr 'A-Z' 'a-z' || true)
    [ -n "$WSL_WINDOWS_ADMIN" ] || WSL_WINDOWS_ADMIN="unknown"
  fi
  [ -d /mnt/c ] && WSL_MNT_C=0
fi

# ─── Werkzeuge ───────────────────────────────────────────────────────────
#
# Reihenfolge: Bordmittel, dann Forensik-Werkzeuge, dann Scanner.
# "source" sagt, woher es kommt: tools = Workspace-tools/, path = PATH.

TOOLS_DIR=$(hf_tools_dir)

probe_tools="ps ss netstat lsof ip ifconfig systemctl journalctl auditctl \
crontab launchctl log scutil dscl kextstat spctl csrutil \
osqueryi yr yara clamscan clamdscan freshclam \
hayabusa chainsaw velociraptor uac avml vol volatility3 \
log2timeline.py psort.py rip.pl \
jq python3 curl openssl sha256sum shasum tar unzip gzip \
powershell.exe reg.exe wevtutil.exe wmic.exe"

TOOLS_JSON=""
MISSING_CORE=""
for t in $probe_tools; do
  p=""
  src="absent"
  if [ -x "$TOOLS_DIR/bin/$t" ]; then p="$TOOLS_DIR/bin/$t"; src="tools"
  elif [ -x "$TOOLS_DIR/$t" ]; then p="$TOOLS_DIR/$t"; src="tools"
  else
    p=$(command -v "$t" 2>/dev/null || true)
    [ -n "$p" ] && src="path"
  fi
  [ "$src" = "absent" ] && continue
  [ -n "$TOOLS_JSON" ] && TOOLS_JSON="$TOOLS_JSON,"
  TOOLS_JSON="$TOOLS_JSON
      {$(hf_json_field name "$t"), $(hf_json_field path "$p"), $(hf_json_field source "$src")}"
done

# Welche Kern-Bordmittel fehlen? Das bestimmt die Abdeckung des Berichts.
case "$OS" in
  linux)
    for t in ps lsof; do hf_have_tool "$t" || MISSING_CORE="$MISSING_CORE $t"; done
    if ! hf_have_tool ss && ! hf_have_tool netstat; then MISSING_CORE="$MISSING_CORE ss/netstat"; fi
    ;;
  darwin)
    for t in ps lsof launchctl log; do hf_have_tool "$t" || MISSING_CORE="$MISSING_CORE $t"; done
    ;;
esac
MISSING_CORE="${MISSING_CORE# }"

# ─── Virenscanner / EDR ──────────────────────────────────────────────────

SECURITY_JSON=""
sec_add() {
  [ -n "$SECURITY_JSON" ] && SECURITY_JSON="$SECURITY_JSON,"
  SECURITY_JSON="$SECURITY_JSON
      {$(hf_json_field product "$1"), $(hf_json_field state "$2"), $(hf_json_field detail "${3:-}")}"
}

case "$OS" in
  linux)
    hf_have_tool clamscan && sec_add "ClamAV" "installiert" "$(clamscan --version 2>/dev/null | head -1)"
    if command -v systemctl >/dev/null 2>&1; then
      for unit in clamav-daemon clamav-freshclam auditd falco wazuh-agent falcon-sensor sentinelone; do
        st=$(systemctl is-active "$unit" 2>/dev/null || true)
        [ -n "$st" ] && [ "$st" != "inactive" ] && [ "$st" != "unknown" ] && sec_add "$unit" "$st" "systemd-Unit"
      done
    fi
    if [ -r /sys/kernel/security/lsm ]; then
      sec_add "LSM" "aktiv" "$(cat /sys/kernel/security/lsm 2>/dev/null)"
    fi
    command -v getenforce >/dev/null 2>&1 && sec_add "SELinux" "$(getenforce 2>/dev/null || echo unknown)" ""
    command -v aa-status >/dev/null 2>&1 && sec_add "AppArmor" "installiert" ""
    ;;
  darwin)
    command -v spctl >/dev/null 2>&1 && sec_add "Gatekeeper" "$(spctl --status 2>/dev/null | head -1)" ""
    command -v csrutil >/dev/null 2>&1 && sec_add "SIP" "$(csrutil status 2>/dev/null | head -1)" ""
    xp="/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist"
    if [ -r "$xp" ] && command -v defaults >/dev/null 2>&1; then
      sec_add "XProtect" "vorhanden" "Version $(defaults read "$xp" CFBundleShortVersionString 2>/dev/null || echo unbekannt)"
    fi
    hf_have_tool clamscan && sec_add "ClamAV" "installiert" ""
    ;;
esac

# Defender-Status der Windows-Seite — nur aus WSL heraus erreichbar.
if [ "$IS_WSL" -eq 0 ] && [ "$WSL_INTEROP" -eq 0 ]; then
  mp=$(powershell.exe -NoProfile -NonInteractive -Command \
    'try { $s = Get-MpComputerStatus -ErrorAction Stop; "{0};{1};{2}" -f $s.AMServiceEnabled, $s.RealTimeProtectionEnabled, $s.AntivirusSignatureLastUpdated } catch { "" }' \
    2>/dev/null | tr -d '\r\n' || true)
  if [ -n "$mp" ]; then
    sec_add "Microsoft Defender (Windows-Seite)" "abgefragt" "AMService;RealTime;SignaturStand = $mp"
  else
    sec_add "Microsoft Defender (Windows-Seite)" "nicht abfragbar" "Get-MpComputerStatus fehlgeschlagen — meist fehlende Admin-Rechte oder Defender ersetzt"
  fi
fi

# ─── Empfehlung und Grenzen ──────────────────────────────────────────────

# Grenzen werden als Klartext gesammelt (eine pro Zeile) und erst bei der
# Ausgabe in JSON bzw. Text umgesetzt. So gibt es nur eine Quelle.
LIMITS_TEXT=""
limit_add() { LIMITS_TEXT="${LIMITS_TEXT}${1}
"; }

# Klartext-Zeilen -> Inhalt eines JSON-Arrays
limits_json() {
  _first=""
  printf '%s' "$LIMITS_TEXT" | awk 'NF' | while IFS= read -r line; do
    [ -n "$_first" ] && printf ','
    _first=1
    printf '\n      %s' "$(hf_json_str "$line")"
  done
}

if [ "$IS_WSL" -eq 0 ]; then
  MODE_REC="wsl"
  if [ "$WSL_INTEROP" -ne 0 ]; then
    MODE_REC="live"
    limit_add "WSL erkannt, aber powershell.exe nicht aufrufbar: der Live-Zustand von Windows (Prozesse, Verbindungen, Eventlogs) ist von hier aus nicht erreichbar. Nur die Linux-Seite und /mnt/c werden geprüft."
  fi
  if [ "$WSL_MNT_C" -ne 0 ]; then
    limit_add "Laufwerk C: ist nicht unter /mnt/c eingebunden — die Dateisystem-Prüfung der Windows-Seite fällt aus."
  fi
  if [ "$WSL_WINDOWS_ADMIN" != "true" ]; then
    limit_add "Die Windows-Seite läuft ohne Administrator-Rechte: Security-Eventlog und Registry-Hives sind nicht exportierbar. Terminal als Administrator neu starten."
  fi
  limit_add "WSL läuft auf dem untersuchten Windows. Ist Windows kompromittiert, kann es auch WSL täuschen. Bei Rot-Befund offline auf einem sauberen Rechner auswerten."
else
  MODE_REC="live"
fi

if [ "$IS_ROOT" -ne 0 ]; then
  if [ "$SUDO_NOPASSWD" -eq 0 ]; then
    limit_add "Kein root, aber sudo ohne Passwort möglich: die Sammlung kann einzelne Schritte erhöhen. Ohne das fehlen Systemlogs, Prozess-Binaries anderer Nutzer und die Zuordnung von Verbindungen zu Prozessen."
  else
    limit_add "Kein root und kein passwortloses sudo: Systemlogs, fremde Prozesse, Audit-Regeln und die Zuordnung von Verbindungen zu Prozessen sind nur teilweise lesbar. Ein Rot-Befund kann dadurch unentdeckt bleiben."
  fi
fi

if [ -n "$MISSING_CORE" ]; then
  limit_add "Fehlende Bordmittel: $MISSING_CORE. Die betroffenen Prüfungen entfallen."
fi

if ! hf_have_sha256; then
  limit_add "Kein SHA-256-Werkzeug gefunden (sha256sum/shasum/openssl). Ohne Prüfsummen ist das Manifest kein Beweismittel."
fi

if ! hf_have_tool hayabusa && ! hf_have_tool chainsaw; then
  limit_add "Weder Hayabusa noch Chainsaw vorhanden: Windows-Eventlogs können nicht regelbasiert ausgewertet werden. Nachladen mit fetch-tools.sh --install hayabusa,chainsaw."
fi
if ! hf_have_tool yr && ! hf_have_tool yara && ! hf_have_tool clamscan; then
  limit_add "Kein Malware-Scanner vorhanden (YARA-X, YARA oder ClamAV). Die Dateiprüfung bleibt auf Hash-Abgleich beschränkt."
fi

# ─── Ausgabe ─────────────────────────────────────────────────────────────

emit_json() {
  cat <<JSON
{
  "schema": "aios.host-forensics.detect/1",
  "generated_at": $(hf_json_str "$(hf_now)"),
  "host": {
    $(hf_json_field hostname "$HOSTNAME_"),
    $(hf_json_field os "$OS"),
    $(hf_json_field os_name "$OS_NAME"),
    $(hf_json_field os_version "$OS_VERSION"),
    $(hf_json_field kernel "$KERNEL"),
    $(hf_json_field arch "$ARCH")
  },
  "privileges": {
    $(hf_json_field user "$USER_"),
    $(hf_json_field uid "$UID_"),
    "is_root": $(hf_json_bool "$IS_ROOT"),
    "sudo_nopasswd": $(hf_json_bool "$SUDO_NOPASSWD")
  },
  "wsl": {
    "is_wsl": $(hf_json_bool "$IS_WSL"),
    "interop": $(hf_json_bool "$WSL_INTEROP"),
    "mnt_c": $(hf_json_bool "$WSL_MNT_C"),
    $(hf_json_field windows_version "$WSL_WINDOWS_VERSION"),
    $(hf_json_field windows_admin "$WSL_WINDOWS_ADMIN")
  },
  $(hf_json_field tools_dir "$TOOLS_DIR"),
  "tools": [${TOOLS_JSON:-}
  ],
  "security_products": [${SECURITY_JSON:-}
  ],
  $(hf_json_field recommended_mode "$MODE_REC"),
  "limitations": [$(limits_json)
  ]
}
JSON
}

emit_text() {
  printf 'Host        : %s (%s %s, %s, Kernel %s)\n' "$HOSTNAME_" "$OS_NAME" "$OS_VERSION" "$ARCH" "$KERNEL"
  printf 'Nutzer      : %s (uid %s)%s\n' "$USER_" "$UID_" "$([ "$IS_ROOT" -eq 0 ] && printf ' — root' || printf ' — kein root')"
  if [ "$IS_WSL" -eq 0 ]; then
    printf 'WSL         : ja, Interop %s, /mnt/c %s, Windows-Admin %s\n' \
      "$([ "$WSL_INTEROP" -eq 0 ] && printf 'verfügbar' || printf 'fehlt')" \
      "$([ "$WSL_MNT_C" -eq 0 ] && printf 'eingebunden' || printf 'fehlt')" \
      "$WSL_WINDOWS_ADMIN"
  else
    printf 'WSL         : nein\n'
  fi
  printf 'Tools-Pfad  : %s\n' "$TOOLS_DIR"
  printf 'Empfehlung  : Betriebsart "%s"\n' "$MODE_REC"
  printf '\nGrenzen dieser Prüfung\n'
  printf '%s\n' '----------------------'
  if [ -n "$LIMITS_TEXT" ]; then
    printf '%s' "$LIMITS_TEXT" | awk 'NF {print "- " $0}'
  else
    printf -- '- keine\n'
  fi
}

if [ "$FORMAT" = "text" ]; then RESULT=$(emit_text); else RESULT=$(emit_json); fi

if [ -n "$OUT" ]; then
  mkdir -p "$(dirname "$OUT")"
  printf '%s\n' "$RESULT" > "$OUT"
  hf_info "Erkennung geschrieben: $OUT"
else
  printf '%s\n' "$RESULT"
fi
