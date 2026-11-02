#!/usr/bin/env bash
# shellcheck shell=bash
#
# AIOS host-forensics — gemeinsame Shell-Helfer.
#
# Wird von detect.sh, collect.sh, collect-windows.sh und fetch-tools.sh per
# `source` eingebunden. Bewusst bash-3.2-kompatibel (macOS liefert bash 3.2),
# also keine assoziativen Arrays und kein ${var^^}.
#
# Alle Operationen auf dem untersuchten System sind lesend. Geschrieben wird
# ausschliesslich in den Fallordner und in das Tools-Verzeichnis.

[ -n "${HF_LIB_SOURCED:-}" ] && return 0
HF_LIB_SOURCED=1

# ─── Ausgabe (Logs auf stderr, Ergebnisse auf stdout) ────────────────────

hf_log()  { printf '%s\n'       "$*" >&2; }
hf_info() { printf '  %s\n'     "$*" >&2; }
hf_warn() { printf 'WARN  %s\n' "$*" >&2; }
hf_err()  { printf 'ERROR %s\n' "$*" >&2; }
hf_die()  { hf_err "$*"; exit 1; }

# ─── Zeit ────────────────────────────────────────────────────────────────

# Alle Zeitstempel in UTC, ISO 8601. Der Bericht normalisiert darauf.
hf_now()      { date -u +%Y-%m-%dT%H:%M:%SZ; }
hf_stamp()    { date -u +%Y%m%dT%H%M%SZ; }

# ─── JSON ────────────────────────────────────────────────────────────────

# Escaped stdin zu einem JSON-String-Inhalt (ohne umschliessende Anfuehrungszeichen).
#
# Mit awk, nicht mit sed: der sonst uebliche ":a;N;$!ba"-Trick gibt auf
# BSD/POSIX-sed (macOS) gar nichts aus, weil dort das Pattern Space bei N am
# Dateiende verworfen wird. Mit sed waere auf macOS jeder Wert leer — und das
# Skript haette trotzdem Exit 0 geliefert.
hf_json_escape() {
  LC_ALL=C awk '
    BEGIN {
      ORS = ""
      # awk kennt kein ord(); die Tabelle liefert den Zahlenwert eines Zeichens,
      # damit Steuerzeichen als \u00XX ausgegeben werden koennen (JSON verlangt das).
      for (i = 1; i < 256; i++) ORD[sprintf("%c", i)] = i
    }
    {
      # Zeilenumbrueche im Wert werden zu \n — awk liest zeilenweise.
      if (NR > 1) printf "\\n"
      n = length($0)
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        if      (c == "\\") printf "\\\\"
        else if (c == "\"")  printf "\\\""
        else if (c == "\t")  printf "\\t"
        else if (c == "\r")  printf "\\r"
        else if (c < " ")    printf "\\u%04x", ORD[c]
        else                 printf "%s", c
      }
    }'
}

# hf_json_str <wert> -> "escaped"
hf_json_str() { printf '"%s"' "$(printf '%s' "${1:-}" | hf_json_escape)"; }

# hf_json_field <name> <wert> -> "name": "escaped"
hf_json_field() { printf '%s: %s' "$(hf_json_str "$1")" "$(hf_json_str "${2:-}")"; }

# hf_json_bool <0|1 exit-code-artig> -> true/false  (0 = true, wie Shell-Erfolg)
hf_json_bool() { if [ "${1:-1}" -eq 0 ] 2>/dev/null; then printf 'true'; else printf 'false'; fi; }

# ─── Plattform ───────────────────────────────────────────────────────────

hf_os() {
  case "$(uname -s 2>/dev/null)" in
    Linux)                 printf 'linux'   ;;
    Darwin)                printf 'darwin'  ;;
    CYGWIN*|MINGW*|MSYS*)  printf 'windows' ;;
    *)                     printf 'unknown' ;;
  esac
}

hf_arch() {
  case "$(uname -m 2>/dev/null)" in
    x86_64|amd64)   printf 'x86_64'  ;;
    aarch64|arm64)  printf 'aarch64' ;;
    armv7l|armv6l)  printf 'arm'     ;;
    *)              uname -m 2>/dev/null || printf 'unknown' ;;
  esac
}

# WSL erkennt man am Kernel-Namen: WSL-Kernel tragen "microsoft" in der
# Release-Zeichenkette. Gilt fuer WSL 1 und WSL 2.
hf_is_wsl() {
  [ "$(hf_os)" = "linux" ] || return 1
  local rel=""
  if [ -r /proc/sys/kernel/osrelease ]; then
    rel=$(LC_ALL=C tr 'A-Z' 'a-z' < /proc/sys/kernel/osrelease 2>/dev/null || true)
  fi
  [ -n "$rel" ] || rel=$(uname -r 2>/dev/null | LC_ALL=C tr 'A-Z' 'a-z' || true)
  case "$rel" in *microsoft*) return 0 ;; esac
  return 1
}

# Interop verfuegbar? Nur dann kann WSL Windows-Programme starten.
hf_wsl_interop() {
  hf_is_wsl || return 1
  command -v powershell.exe >/dev/null 2>&1
}

hf_is_root() { [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; }

# Nicht-interaktives sudo moeglich? (Fragt kein Passwort ab.)
hf_has_sudo() {
  command -v sudo >/dev/null 2>&1 || return 1
  sudo -n true >/dev/null 2>&1
}

# ─── Hashes ──────────────────────────────────────────────────────────────

hf_sha256_file() {
  local f="$1"
  [ -f "$f" ] || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$f" 2>/dev/null | awk '{print $1; exit}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$f" 2>/dev/null | awk '{print $1; exit}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$f" 2>/dev/null | awk '{print $NF; exit}'
  else
    return 1
  fi
}

# SHA-256 von stdin.
hf_sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum 2>/dev/null | awk '{print $1; exit}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 2>/dev/null | awk '{print $1; exit}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 2>/dev/null | awk '{print $NF; exit}'
  else
    return 1
  fi
}

# Hash ueber einen Verzeichnisbaum (fuer Regelsammlungen).
# Gehasht wird die sortierte Liste der Datei-Hashes, ohne Namen: damit ist
# das Ergebnis unabhaengig von der Reihenfolge und auch bei Dateinamen mit
# Sonderzeichen stabil. Eine reine Umbenennung faellt dadurch nicht auf —
# fuer eine Integritaetspruefung von Regeldateien reicht das.
hf_sha256_tree() {
  local dir="$1"
  [ -d "$dir" ] || return 1
  ( cd "$dir" 2>/dev/null || exit 1
    find . -type f -print0 2>/dev/null \
      | while IFS= read -r -d '' f; do hf_sha256_file "$f" 2>/dev/null || printf 'UNREADABLE'; printf '\n'; done
  ) | LC_ALL=C sort | hf_sha256_stdin
}

hf_have_sha256() {
  command -v sha256sum >/dev/null 2>&1 \
    || command -v shasum >/dev/null 2>&1 \
    || command -v openssl >/dev/null 2>&1
}

hf_filesize() { [ -f "$1" ] && wc -c < "$1" 2>/dev/null | tr -d ' ' || printf '0'; }

# mtime einer Datei als UTC-ISO-8601. GNU nutzt `stat -c`/`date -d @`,
# BSD/macOS `stat -f`/`date -r` — hier beide Varianten der Reihe nach.
hf_mtime_utc() {
  local f="$1" e=""
  e=$(stat -c %Y -- "$f" 2>/dev/null) || e=$(stat -f %m -- "$f" 2>/dev/null) || { printf 'unknown'; return 0; }
  case "$e" in ''|*[!0-9]*) printf 'unknown'; return 0 ;; esac
  date -u -d "@$e" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -r "$e" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || printf 'unknown'
}

# Rechte und Eigner einer Datei. stat statt `ls | awk`: ls-Ausgabe ist nicht
# zum Parsen gedacht, und bei Dateinamen mit Sonderzeichen wird es unsauber.
# GNU und BSD/macOS haben unterschiedliche Schalter, deshalb beide.
hf_stat_mode() {
  stat -c '%A' -- "$1" 2>/dev/null || stat -f '%Sp' -- "$1" 2>/dev/null || printf '?'
}

hf_stat_owner() {
  stat -c '%U:%G' -- "$1" 2>/dev/null || stat -f '%Su:%Sg' -- "$1" 2>/dev/null || printf '?'
}

# Pfad fuer eine TSV-Spalte absichern. Tabulator und Zeilenumbruch im
# Dateinamen wuerden das Format zerstoeren — und genau solche Namen kommen
# bei Malware vor. Betroffene Pfade werden bash-gequotet und mit "Q:"
# markiert, damit der echte Name verlustfrei erhalten bleibt.
hf_tsv_path() {
  case "$1" in
    *$'\t'*|*$'\r'*|*$'\n'*)
      printf 'Q:%s' "$(printf '%q' "$1")" ;;
    *) printf '%s' "$1" ;;
  esac
}

# ─── Tools ───────────────────────────────────────────────────────────────

# Wo die portablen Tools liegen. Die Arbeitsverzeichnis-Vorlage setzt
# HOST_FORENSICS_TOOLS auf ./tools; ohne die Variable wird ./tools relativ
# zum aktuellen Verzeichnis angenommen.
hf_tools_dir() { printf '%s' "${HOST_FORENSICS_TOOLS:-./tools}"; }

# hf_tool <name> -> Pfad auf stdout, Exit 0 wenn gefunden.
# Reihenfolge: Workspace-tools/bin, Workspace-tools, dann PATH.
hf_tool() {
  local name="$1" dir
  dir=$(hf_tools_dir)
  if [ -x "$dir/bin/$name" ];  then printf '%s' "$dir/bin/$name";  return 0; fi
  if [ -x "$dir/$name" ];      then printf '%s' "$dir/$name";      return 0; fi
  local p
  p=$(command -v "$name" 2>/dev/null) && { printf '%s' "$p"; return 0; }
  return 1
}

hf_have_tool() { hf_tool "$1" >/dev/null 2>&1; }

# ─── Fallordner und Beweiskette ──────────────────────────────────────────
#
# HF_CASE_DIR  Wurzel des Fallordners (absolut, nach hf_case_init gesetzt)
# HF_COC       chain-of-custody.log
# HF_SKIPPED   Notizen fuer summary.txt: was NICHT gesammelt wurde und warum

HF_CASE_DIR=""
HF_COC=""
HF_SKIPPED=""

# hf_case_init <verzeichnis> <modus> <quell-os>
hf_case_init() {
  local dir="$1" mode="${2:-live}" source_os="${3:-$(hf_os)}"

  case "$dir" in
    "") hf_die "hf_case_init: Fallordner fehlt" ;;
  esac
  mkdir -p "$dir" || hf_die "Fallordner nicht anlegbar: $dir"
  # Absolut machen, damit spaetere cd-Wechsel nichts kaputt machen.
  HF_CASE_DIR=$(cd "$dir" && pwd) || hf_die "Fallordner nicht erreichbar: $dir"

  local d
  for d in volatile persistence accounts logs filesystem hashes memory; do
    mkdir -p "$HF_CASE_DIR/$d"
  done

  HF_COC="$HF_CASE_DIR/chain-of-custody.log"
  if [ ! -f "$HF_COC" ]; then
    {
      printf '# AIOS host-forensics — chain of custody\n'
      printf '# Jede Zeile: UTC-Zeitstempel, Zieldatei (relativ), Exit-Code oder "skipped", Bytes, Befehl\n'
      printf '# Spaltentrenner: Tabulator. Diese Datei wird nur angehaengt, nie veraendert.\n'
      printf '#\n'
    } > "$HF_COC"
  fi
  # Der begin-Satz wird bei JEDEM Lauf angehaengt, auch beim zweiten in denselben
  # Fallordner — sonst fehlen fuer diesen Lauf Startzeit, Modus und Operator.
  printf '# begin\t%s\tmode=%s\tsource_os=%s\thost=%s\toperator=%s\n' \
    "$(hf_now)" "$mode" "$source_os" "$(hostname 2>/dev/null || echo unknown)" \
    "$(id -un 2>/dev/null || echo unknown)" >> "$HF_COC"

  HF_SKIPPED=""
  hf_info "Fallordner: $HF_CASE_DIR"
}

hf_case_assert() { [ -n "$HF_CASE_DIR" ] || hf_die "Kein Fallordner initialisiert (hf_case_init fehlt)"; }

# Protokollzeile schreiben. Argumente werden nicht interpretiert.
hf_coc() {
  local rel="$1" rc="$2" bytes="$3"; shift 3
  # Auch dieses Protokoll ist tabulatorgetrennt: Pfade mit Steuerzeichen
  # werden wie im Manifest gequotet, damit die Spalten halten.
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$(hf_now)" "$(hf_tsv_path "$rel")" "$rc" "$bytes" "$(hf_tsv_path "$*")" >> "$HF_COC"
}

# Notiz fuer summary.txt: Quelle konnte nicht gesammelt werden.
hf_skip() {
  HF_SKIPPED="${HF_SKIPPED}${1}: ${2}
"
  hf_coc "$1" "skipped" "0" "SKIPPED: $2"
  hf_info "übersprungen — $1 ($2)"
}

# hf_run <ziel-relativ> <programm> [argumente...]
# Kein Shell-Interpreter: Argumente gehen unveraendert an execve.
# Ein Fehlschlag beendet die Sammlung NICHT — er wird protokolliert.
hf_run() {
  hf_case_assert
  local rel="$1"; shift
  [ "$#" -gt 0 ] || { hf_warn "hf_run $rel: kein Befehl"; return 0; }

  if ! command -v "$1" >/dev/null 2>&1; then
    hf_skip "$rel" "Werkzeug nicht vorhanden: $1"
    return 0
  fi

  local out="$HF_CASE_DIR/$rel" rc=0
  mkdir -p "$(dirname "$out")"
  "$@" >"$out" 2>"$out.stderr" || rc=$?
  if [ ! -s "$out.stderr" ]; then rm -f "$out.stderr"; fi
  hf_coc "$rel" "$rc" "$(hf_filesize "$out")" "$*"
  return 0
}

# hf_sh <ziel-relativ> <shell-schnipsel> [benoetigte-werkzeuge...]
#
# Fuer Pipelines und Globs. Der Schnipsel stammt IMMER aus diesem Repo,
# niemals aus Nutzereingaben — sonst waere das eine Injection-Stelle.
#
# Zwei Eigenschaften, die den Unterschied zwischen "geprueft" und "nicht
# geprueft" tragen:
#
#   1. Die benoetigten Werkzeuge werden VORHER geprueft. Fehlt eines, ist das
#      eine Luecke in der Abdeckung — nicht ein leeres Ergebnis. Ohne diese
#      Pruefung behauptet summary.txt auf einem macOS ohne profiles(8), die
#      Konfigurationsprofile seien geprueft und sauber.
#   2. bash mit pipefail statt sh. Ohne pipefail liefert eine Pipeline den
#      Status der LETZTEN Stufe: scheitert die erste (fehlendes Werkzeug,
#      GNU-only Option), kommt trotzdem 0 und 0 Bytes heraus — und genau das
#      wird als "geprueft, kein Treffer" einsortiert.
hf_sh() {
  hf_case_assert
  local rel="$1" snippet="$2"; shift 2

  local t
  for t in "$@"; do
    if ! command -v "$t" >/dev/null 2>&1; then
      hf_skip "$rel" "Werkzeug nicht vorhanden: $t"
      return 0
    fi
  done

  local out="$HF_CASE_DIR/$rel" rc=0
  mkdir -p "$(dirname "$out")"
  bash -c "set -o pipefail; $snippet" >"$out" 2>"$out.stderr" || rc=$?
  if [ ! -s "$out.stderr" ]; then rm -f "$out.stderr"; fi
  hf_coc "$rel" "$rc" "$(hf_filesize "$out")" "bash -c: $snippet"

  # Ein Fehlschlag ist eine Luecke, kein Befund. Ohne diese Zeile landet er
  # in "Befehle mit Fehlern", aber eben auch nicht in "nicht gesammelt" —
  # und ein leeres Ergebnis daneben sieht wie ein saubereres System aus.
  if [ "$rc" -ne 0 ]; then
    hf_skip "$rel" "Befehl endete mit Exit-Code $rc — Ergebnis unvollständig"
  fi
  return 0
}

# hf_env_sanitized <ziel-relativ>
#
# Umgebungsvariablen sichern, ohne Zugangsdaten in den Fallordner zu schreiben.
#
# Warum nicht `env | sed`: `env` gibt einen mehrzeiligen Wert (ein PEM-Key,
# ein JSON-Service-Account) ueber mehrere Zeilen aus. Eine am Zeilenanfang
# verankerte Ersetzung trifft nur die ERSTE Zeile; die restlichen Zeilen
# landen ungeschuetzt in der Datei, und ein nachgeschaltetes sort verteilt sie
# noch im ganzen File. Der Fallordner wird gehasht, archiviert und
# weitergegeben — damit waere die Beweissicherung selbst das Leck.
#
# Deshalb: pro Variable entscheiden, den Wert auf eine Zeile zwingen, und zum
# Vergleich selbst grossschreiben statt sed-Flag /I zu nutzen (eine
# GNU-Erweiterung, die auf macOS einen Fehler wirft).
hf_env_sanitized() {
  hf_case_assert
  local rel="$1"
  local out="$HF_CASE_DIR/$rel"
  mkdir -p "$(dirname "$out")"

  local n u v redacted=0 total=0
  {
    for n in $(compgen -e 2>/dev/null); do
      total=$((total + 1))
      u=$(printf '%s' "$n" | LC_ALL=C tr 'a-z' 'A-Z')
      case "$u" in
        # Eine Zeile, keine Fortsetzung: ein "\" mitten in einem case-Muster
        # macht die folgenden Zeichen zu Teil des Musters (mit Leerzeichen),
        # und *CREDENTIAL* haette dann nie gegriffen.
        # *PASS* deckt PASSWORD/PASSWD mit ab, *KEY* auch APIKEY.
        *TOKEN*|*SECRET*|*PASS*|*KEY*|*SESSION*|*CREDENTIAL*|*AUTH*|*COOKIE*|*BEARER*|*PRIVATE*|*SIGNATURE*|*SALT*)
          printf '%s=<redigiert>\n' "$n"
          redacted=$((redacted + 1))
          ;;
        *)
          # Mehrzeilige Werte auf eine Zeile zwingen: sonst bricht die Zuordnung
          # Name->Wert, und ein Geheimnis in Zeile 2 waere nicht mehr erkennbar.
          v=$(printf '%s' "${!n}" | tr '\n\r\t' '   ')
          # Zugangsdaten in URLs (https://nutzer:geheim@host) ebenfalls entfernen.
          v=$(printf '%s' "$v" | LC_ALL=C sed -E 's#(://)[^/:@[:space:]]+:[^/@[:space:]]+@#\1<redigiert>:<redigiert>@#g')
          printf '%s=%s\n' "$n" "$v"
          ;;
      esac
    done | LC_ALL=C sort
  } > "$out"

  hf_coc "$rel" "0" "$(hf_filesize "$out")" "hf_env_sanitized ($total Variablen, $redacted redigiert)"
  return 0
}

# hf_copy <quelle> <ziel-relativ>
# Kopiert lesend. Verzeichnisse werden rekursiv kopiert, Symlinks nicht verfolgt.
hf_copy() {
  hf_case_assert
  local src="$1" rel="$2" rc=0
  if [ ! -e "$src" ]; then
    hf_skip "$rel" "nicht vorhanden: $src"
    return 0
  fi
  if [ ! -r "$src" ]; then
    hf_skip "$rel" "nicht lesbar (Rechte fehlen): $src"
    return 0
  fi
  local out="$HF_CASE_DIR/$rel"
  mkdir -p "$(dirname "$out")"
  if [ -d "$src" ]; then
    cp -R -- "$src" "$out" 2>/dev/null || rc=$?
  else
    cp -p -- "$src" "$out" 2>/dev/null || rc=$?
  fi
  hf_coc "$rel" "$rc" "$(hf_filesize "$out")" "cp $src"
  return 0
}

# hf_path_slug <pfad> -> dateinamenstauglicher, EINDEUTIGER Bezeichner
#
# Ein reines tr -c kollabiert verschiedene Pfade auf denselben Namen
# (/opt/a und /opt-a werden beide zu _opt_a). Die zweite Liste ueberschreibt
# dann die erste, waehrend das Protokoll zwei Einträge zeigt — und niemand
# merkt, dass eine Quelle fehlt. Ein kurzer Hash des Originalpfads haengt
# hinten dran und macht den Namen wieder eindeutig.
hf_path_slug() {
  local p="$1" base h
  base=$(printf '%s' "$p" | LC_ALL=C tr -c 'A-Za-z0-9._-' '_')
  h=$(printf '%s' "$p" | hf_sha256_stdin 2>/dev/null) || h=""
  if [ -n "$h" ]; then
    printf '%s-%s' "$base" "$(printf '%s' "$h" | cut -c1-8)"
  else
    printf '%s' "$base"
  fi
}

# hf_find_tsv <ziel-relativ> <verzeichnis> [find-argumente...]
#
# Dateiliste mit echten Spalten: Pfad, Bytes, mtime (UTC), Rechte, Eigner.
# Der Pfad wird wie im Manifest behandelt — ein Dateiname mit Tabulator oder
# Zeilenumbruch wuerde die Spalten sonst zerstoeren, und genau solche Namen
# legt Malware an. Die Schleife laeuft in bash (nicht in einem sh-Schnipsel),
# damit hf_tsv_path zur Verfuegung steht.
#
# HF_FIND_LIMIT begrenzt die Zeilen (Standard 5000), damit eine Live-Sammlung
# nicht an einem riesigen Verzeichnis haengenbleibt.
hf_find_tsv() {
  hf_case_assert
  local rel="$1" dir="$2"; shift 2
  local out="$HF_CASE_DIR/$rel"
  local limit="${HF_FIND_LIMIT:-5000}"
  mkdir -p "$(dirname "$out")"

  if [ ! -d "$dir" ]; then
    hf_skip "$rel" "nicht vorhanden: $dir"
    return 0
  fi

  # Ein relativer Pfad, der mit "-" beginnt, wuerde von find als Praedikat
  # gelesen; find haette dann keinen Pfad-Operanden und wuerde "." durchsuchen.
  # Das "./" davor macht daraus wieder einen Pfad.
  case "$dir" in
    /*) ;;
    *)  dir="./${dir#./}" ;;
  esac

  {
    printf '# Spalten (Tabulator): pfad\tbytes\tmtime_utc\trechte\teigner\n'
    printf '# Pfade mit Steuerzeichen sind bash-gequotet und mit "Q:" markiert.\n'
  } > "$out"

  local n=0 f size mt perms owner
  while IFS= read -r -d '' f; do
    size=$(hf_filesize "$f")
    mt=$(hf_mtime_utc "$f")
    perms=$(hf_stat_mode "$f")
    owner=$(hf_stat_owner "$f")
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "$(hf_tsv_path "$f")" "$size" "$mt" "${perms:-?}" "${owner:-?}" >> "$out"
    n=$((n + 1))
    if [ "$n" -ge "$limit" ]; then
      printf '# ABGESCHNITTEN bei %s Einträgen — Verzeichnis enthält mehr.\n' "$limit" >> "$out"
      break
    fi
  done < <(find "$dir" "$@" -print0 2>/dev/null)

  hf_coc "$rel" "0" "$(hf_filesize "$out")" "find $dir $* (hf_find_tsv, $n Einträge)"
  return 0
}

# Manifest ueber den gesamten Fallordner erzeugen und Lauf abschliessen.
# Laeuft am Ende, damit garantiert jede gesammelte Datei erfasst ist.
hf_case_finalize() {
  hf_case_assert
  local manifest="$HF_CASE_DIR/manifest.tsv"
  local summary="$HF_CASE_DIR/summary.txt"
  local mode="${1:-live}"

  if ! hf_have_sha256; then
    hf_warn "Kein SHA-256-Werkzeug gefunden — Manifest ohne Hashes. Beweiswert eingeschränkt."
  fi

  {
    printf '# AIOS host-forensics — Manifest\n'
    printf '# Erzeugt: %s\n' "$(hf_now)"
    printf '# Spalten (Tabulator): sha256  bytes  mtime_utc  pfad_relativ\n'
    printf '# Erfasst sind die Beweisdateien. Nicht erfasst sind die drei\n'
    printf '# Buchhaltungsdateien manifest.tsv, summary.txt und\n'
    printf '# chain-of-custody.log — sie entstehen bzw. wachsen nach dem\n'
    printf '# Hashen. Das Protokoll haelt am Ende den Hash dieses Manifests.\n'
    printf '# Pfade mit Steuerzeichen sind bash-gequotet und mit "Q:" markiert.\n'
  } > "$manifest"

  local count=0 odd=0 f rel hash size mt
  while IFS= read -r -d '' f; do
    rel="${f#"$HF_CASE_DIR"/}"
    case "$rel" in
      manifest.tsv|summary.txt|chain-of-custody.log) continue ;;
    esac
    hash=$(hf_sha256_file "$f" 2>/dev/null) || hash="UNAVAILABLE"
    [ -n "$hash" ] || hash="UNAVAILABLE"
    size=$(hf_filesize "$f")
    mt=$(hf_mtime_utc "$f")
    local safe
    safe=$(hf_tsv_path "$rel")
    case "$safe" in Q:*) odd=$((odd + 1)) ;; esac
    printf '%s\t%s\t%s\t%s\n' "$hash" "$size" "$mt" "$safe" >> "$manifest"
    count=$((count + 1))
  done < <(find "$HF_CASE_DIR" -type f -print0 2>/dev/null)

  local manifest_hash
  manifest_hash=$(hf_sha256_file "$manifest" 2>/dev/null) || manifest_hash="UNAVAILABLE"

  {
    printf 'AIOS host-forensics — Sammlungsbericht\n'
    printf '=======================================\n\n'
    printf 'Abgeschlossen : %s\n' "$(hf_now)"
    printf 'Betriebsart   : %s\n' "$mode"
    printf 'Host          : %s\n' "$(hostname 2>/dev/null || echo unknown)"
    printf 'System        : %s %s\n' "$(hf_os)" "$(hf_arch)"
    printf 'Operator      : %s (uid %s)\n' "$(id -un 2>/dev/null || echo unknown)" "$(id -u 2>/dev/null || echo '?')"
    if hf_is_root; then printf 'Rechte        : root\n'; else printf 'Rechte        : eingeschränkt (kein root) — Lücken siehe unten\n'; fi
    printf 'Dateien       : %s\n' "$count"
    if [ "$odd" -gt 0 ]; then
      printf 'Auffällig     : %s Pfad(e) mit Steuerzeichen im Namen (im Manifest "Q:"-markiert) — eigener Befund\n' "$odd"
    fi
    printf 'Manifest      : manifest.tsv (sha256 %s)\n' "$manifest_hash"
    printf '\n'
    printf 'Nicht gesammelt (Lücke in der Abdeckung)\n'
    printf '%s\n' '----------------------------------------'
    if [ -n "$HF_SKIPPED" ]; then printf '%s' "$HF_SKIPPED"; else printf '(nichts übersprungen)\n'; fi
    printf '\n'
    printf 'Geprüft, kein Treffer (leeres Ergebnis, Befehl lief fehlerfrei)\n'
    printf '%s\n' '--------------------------------------------------------------'
    # Wichtig für den Bericht: ein leeres Ergebnis ist eine Feststellung,
    # eine ausgelassene Quelle ist eine Lücke. Beides darf nicht verwechselt
    # werden, sonst wird aus "nicht geprüft" versehentlich ein "sauber".
    # awk und sort liefern bei leerer Eingabe beide Exit 0, ein "|| printf"
    # haette also nie gegriffen. Deshalb erst einsammeln, dann pruefen.
    _empty_ok=$(awk -F'\t' '!/^#/ && $2 !~ /^#/ && $3 == "0" && $4 == "0" { print "  " $2 }' "$HF_COC" 2>/dev/null | LC_ALL=C sort -u)
    if [ -n "$_empty_ok" ]; then printf '%s\n' "$_empty_ok"; else printf '%s\n' '  (keine)'; fi
    printf '\n'
    printf 'Befehle mit Fehlern (Ergebnis unvollständig, stderr im Fallordner)\n'
    printf '%s\n' '-----------------------------------------------------------------'
    _failed=$(awk -F'\t' '!/^#/ && $2 !~ /^#/ && $3 != "0" && $3 != "skipped" { print "  Exit " $3 "  " $2 }' "$HF_COC" 2>/dev/null | LC_ALL=C sort -u)
    if [ -n "$_failed" ]; then printf '%s\n' "$_failed"; else printf '%s\n' '  (keine)'; fi
    printf '\n'
    printf 'Diese Sammlung ist eine Momentaufnahme mit Bordmitteln des laufenden\n'
    printf 'Systems. Ein Rootkit kann Prozesse, Dateien und Verbindungen vor diesen\n'
    printf 'Werkzeugen verbergen. Die Ergebnisse sind daher "mindestens", nie "genau".\n'
  } > "$summary"

  printf '# end\t%s\tfiles=%s\tmanifest_sha256=%s\n' "$(hf_now)" "$count" "$manifest_hash" >> "$HF_COC"

  hf_info "Manifest: $count Dateien, sha256 $manifest_hash"
  printf '%s\n' "$HF_CASE_DIR"
}
