#!/usr/bin/env bash
#
# AIOS host-forensics — portable Werkzeuge nachladen und prüfen.
#
# Lädt die im Katalog (tools.catalog.tsv) gepinnten Versionen in das
# Tools-Verzeichnis des Arbeitsverzeichnisses und prüft jede Datei gegen die
# vom Projekt veröffentlichte SHA-256-Prüfsumme.
#
# Woher die Prüfsumme kommt (Spalte digest_source im Katalog):
#   gh-api  Die GitHub-Release-API nennt pro Asset ein Feld "digest"
#           (sha256:...). Das ist die Angabe des Projekts auf GitHub.
#   <URL>   Das Projekt veröffentlicht eine Checksum-Datei (z. B. *.sha256).
#   none    Das Projekt veröffentlicht keine Prüfsumme. Dann greift
#           Trust-on-First-Use: der Hash des ersten Downloads wird in
#           tools/lock.tsv festgeschrieben, jeder spätere Lauf vergleicht
#           dagegen. Ein solcher Download braucht --allow-unpinned.
#
# tools/lock.tsv ist die Prüfsummen-Datei des Arbeitsverzeichnisses. Weicht
# ein erneuter Download davon ab, bricht das Skript ab — das ist der Fall,
# den man sehen will.
#
# Verwendung:
#   fetch-tools.sh --list
#   fetch-tools.sh --install hayabusa,chainsaw,yara-x
#   fetch-tools.sh --install all
#   fetch-tools.sh --verify
#
# Optionen:
#   --dir D            Zielverzeichnis (Standard: $HOST_FORENSICS_TOOLS oder ./tools)
#   --allow-unpinned   Werkzeuge ohne veröffentlichte Prüfsumme zulassen
#   --force            Abweichenden Hash akzeptieren und lock.tsv überschreiben
#   --os / --arch      Plattform überschreiben (für Offline-Vorbereitung)
#
# Exit-Codes: 0 = alles in Ordnung, 1 = Fehler/Abbruch, 2 = Prüfsummen-Konflikt.

set -uo pipefail

# CDPATH= setzt die Variable nur fuer dieses cd: ein gesetztes CDPATH
# wuerde sonst in ein ganz anderes Verzeichnis wechseln.
# shellcheck disable=SC1007
HF_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$HF_SCRIPT_DIR/lib.sh"

CATALOG="$HF_SCRIPT_DIR/../tools.catalog.tsv"
ACTION=""
WANT=""
TOOLS_DIR=""
ALLOW_UNPINNED=1
FORCE=1
TARGET_OS=""
TARGET_ARCH=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --list)           ACTION="list"; shift ;;
    --install)        ACTION="install"; WANT="${2:-}"; [ -n "$WANT" ] || hf_die "--install braucht eine Liste oder 'all'"; shift 2 ;;
    --verify)         ACTION="verify"; shift ;;
    --dir)            TOOLS_DIR="${2:-}"; [ -n "$TOOLS_DIR" ] || hf_die "--dir braucht einen Pfad"; shift 2 ;;
    --allow-unpinned) ALLOW_UNPINNED=0; shift ;;
    --force)          FORCE=0; shift ;;
    --os)             TARGET_OS="${2:-}"; shift 2 ;;
    --arch)           TARGET_ARCH="${2:-}"; shift 2 ;;
    -h|--help)        sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                hf_die "Unbekannte Option: $1" ;;
  esac
done

[ -n "$ACTION" ] || hf_die "Eine Aktion fehlt: --list, --install <namen|all> oder --verify"
[ -f "$CATALOG" ] || hf_die "Katalog nicht gefunden: $CATALOG"

[ -n "$TOOLS_DIR" ] || TOOLS_DIR=$(hf_tools_dir)
OS=${TARGET_OS:-$(hf_os)}
ARCH=${TARGET_ARCH:-$(hf_arch)}

# WSL analysiert Windows-Artefakte mit Linux-Werkzeugen — die Linux-Binaries
# sind hier also das Richtige, nicht die Windows-Variante.
if hf_is_wsl && [ -z "$TARGET_OS" ]; then
  hf_info "WSL erkannt: es werden die Linux-Binaries geladen (sie werten die Windows-Artefakte aus)."
fi

LOCK="$TOOLS_DIR/lock.tsv"

# ─── Hilfsmittel prüfen ──────────────────────────────────────────────────

hf_have_sha256 || hf_die "Kein SHA-256-Werkzeug (sha256sum, shasum oder openssl). Ohne Prüfsummen wird hier nichts installiert."
command -v curl >/dev/null 2>&1 || hf_die "curl fehlt."

# JSON aus der GitHub-API lesen: jq, sonst python3. Kein handgeschriebenes
# Parsen mit sed — daran scheitert man an jedem Sonderfall.
JSON_READER=""
if command -v jq >/dev/null 2>&1; then
  JSON_READER="jq"
elif command -v python3 >/dev/null 2>&1; then
  JSON_READER="python3"
fi

# ─── Katalog lesen ───────────────────────────────────────────────────────
#
# Zeilen passend zu OS/Arch. "any" passt immer.

catalog_rows() {
  awk -F'\t' -v os="$OS" -v arch="$ARCH" '
    /^#/ { next }
    NF < 10 { next }
    ($2 == os || $2 == "any") && ($3 == arch || $3 == "any") { print }
  ' "$CATALOG"
}

catalog_ids() { catalog_rows | cut -f1 | LC_ALL=C sort -u; }

# ─── Prüfsumme beschaffen ────────────────────────────────────────────────

# github_asset_digest <url> -> sha256 auf stdout, oder leer
github_asset_digest() {
  local url="$1"
  # https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>
  local rest="${url#https://github.com/}"
  local owner repo tag asset
  owner=$(printf '%s' "$rest" | cut -d/ -f1)
  repo=$(printf '%s' "$rest" | cut -d/ -f2)
  tag=$(printf '%s' "$rest" | cut -d/ -f5)
  asset=$(printf '%s' "$rest" | cut -d/ -f6-)
  if [ -z "$owner" ] || [ -z "$repo" ] || [ -z "$tag" ] || [ -z "$asset" ]; then
    return 1
  fi

  local api="https://api.github.com/repos/$owner/$repo/releases/tags/$tag"
  local json
  json=$(curl -fsSL --proto '=https' --tlsv1.2 --max-time 60 \
           -H 'Accept: application/vnd.github+json' "$api" 2>/dev/null) || return 1
  [ -n "$json" ] || return 1

  case "$JSON_READER" in
    jq)
      printf '%s' "$json" | jq -r --arg a "$asset" \
        '.assets[]? | select(.name == $a) | (.digest // "") | sub("^sha256:"; "")' 2>/dev/null \
        | head -1
      ;;
    python3)
      # -I: keine Module aus dem aktuellen Verzeichnis laden.
      printf '%s' "$json" | python3 -I -c '
import json, sys
want = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for a in data.get("assets") or []:
    if a.get("name") == want:
        d = a.get("digest") or ""
        print(d[7:] if d.startswith("sha256:") else d)
        break
' "$asset" 2>/dev/null
      ;;
    *) return 1 ;;
  esac
}

# checksum_from_url <url> <asset-name> -> sha256 auf stdout, oder leer
#
# Übliche Formate: "<hash>  <datei>", "<hash> *<datei>" oder nur "<hash>".
#
# Drei Fallen, die hier bewusst vermieden werden:
#   1. h darf nicht über Zeilen hinweg bestehen bleiben — sonst liefert eine
#      Kommentarzeile, die den Asset-Namen enthält, den Hash der Zeile davor.
#   2. Der Dateiname muss als ganzes Feld verglichen werden, nicht als
#      Teilstring: sonst passt "uac-3.4.0.tar.gz.sha256" auf die Suche nach
#      "uac-3.4.0.tar.gz" und liefert den Hash der Signaturdatei.
#   3. Eine Datei, die nur den Hash enthält (NF == 1), ist der dokumentierte
#      Normalfall und muss ohne Namensvergleich akzeptiert werden.
checksum_from_url() {
  local url="$1" asset="$2" body
  body=$(curl -fsSL --proto '=https' --tlsv1.2 --max-time 60 "$url" 2>/dev/null) || return 1
  printf '%s\n' "$body" | LC_ALL=C awk -v a="$asset" '
    {
      h = ""; matched = 0
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^[0-9a-fA-F]{64}$/)      h = $i
        else if ($i == a || $i == "*" a)   matched = 1
      }
      if (h != "" && (NF == 1 || matched)) { print tolower(h); exit }
    }'
  return 0
}

# ─── lock.tsv ────────────────────────────────────────────────────────────

# Zwei Hashes pro Eintrag, und zwar bewusst:
#   artifact_sha256  — die heruntergeladene Datei (das, was gegen die Angabe
#                      des Projekts geprueft wurde)
#   installed_sha256 — was danach in tools/ liegt (bei Archiven eine ANDERE
#                      Datei als das Archiv)
# Ein einziger Hash kann beides nicht leisten: --verify muss das Installierte
# pruefen, der Upstream-Vergleich das Archiv.
lock_get_artifact() {
  local id="$1" os="$2" arch="$3"
  [ -f "$LOCK" ] || return 1
  awk -F'\t' -v i="$id" -v o="$os" -v a="$arch" \
    '!/^#/ && $1 == i && $2 == o && $3 == a { print $5; exit }' "$LOCK"
}

lock_put() {
  local id="$1" os="$2" arch="$3" version="$4" sha="$5" source="$6" entry="$7" installed_sha="$8"
  mkdir -p "$TOOLS_DIR"
  if [ ! -f "$LOCK" ]; then
    {
      printf '# AIOS host-forensics — Prüfsummen der installierten Werkzeuge\n'
      printf '# Spalten (Tabulator): id\tos\tarch\tversion\tartifact_sha256\tdigest_source\tinstalliert_am\tpfad\tinstalled_sha256\n'
      printf '#   artifact_sha256  = Hash der heruntergeladenen Datei (gegen die Projekt-Angabe geprüft)\n'
      printf '#   installed_sha256 = Hash dessen, was in tools/ liegt; bei Verzeichnissen ein Baum-Hash\n'
      printf '# Weicht ein erneuter Download ab, bricht fetch-tools.sh ab. Das ist Absicht.\n'
      printf '# Diese Datei gehört zum Arbeitsverzeichnis, nicht in das AIOS-Repository.\n'
    } > "$LOCK"
  fi
  # Alten Eintrag entfernen, neuen anhängen.
  if grep -q . "$LOCK" 2>/dev/null; then
    awk -F'\t' -v i="$id" -v o="$os" -v a="$arch" \
      'BEGIN { OFS = "\t" } /^#/ { print; next } !($1 == i && $2 == o && $3 == a) { print }' \
      "$LOCK" > "$LOCK.new" && mv -f "$LOCK.new" "$LOCK"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$id" "$os" "$arch" "$version" "$sha" "$source" "$(hf_now)" "$entry" "$installed_sha" >> "$LOCK"
}

# ─── Entpacken ───────────────────────────────────────────────────────────

# Archive können Einträge mit ".." oder absoluten Pfaden enthalten und damit
# aus dem Zielverzeichnis ausbrechen. Vorher prüfen, nicht hinterher.
archive_is_safe() {
  local file="$1" kind="$2" listing=""
  case "$kind" in
    zip)   command -v unzip >/dev/null 2>&1 || return 1
           listing=$(unzip -Z1 -- "$file" 2>/dev/null) || return 1 ;;
    targz) listing=$(tar -tzf "$file" 2>/dev/null) || return 1 ;;
    *)     return 0 ;;
  esac
  printf '%s\n' "$listing" | while IFS= read -r e; do
    case "$e" in
      /*|*/../*|../*|*/..) printf 'unsafe'; return ;;
    esac
  done | grep -q unsafe && return 1
  return 0
}

# ─── Installation ────────────────────────────────────────────────────────

install_one() {
  local row="$1"
  local id os arch version url digest_source extract entry license purpose
  id=$(printf '%s' "$row" | cut -f1)
  os=$(printf '%s' "$row" | cut -f2)
  arch=$(printf '%s' "$row" | cut -f3)
  version=$(printf '%s' "$row" | cut -f4)
  url=$(printf '%s' "$row" | cut -f5)
  digest_source=$(printf '%s' "$row" | cut -f6)
  extract=$(printf '%s' "$row" | cut -f7)
  entry=$(printf '%s' "$row" | cut -f8)
  license=$(printf '%s' "$row" | cut -f9)
  purpose=$(printf '%s' "$row" | cut -f10)

  # Der CLI-Name wird in do_install geprüft, diese Werte kommen aber aus der
  # Katalogdatei — und $id landet in `rm -rf "$TOOLS_DIR/share/$id"`, $entry
  # in Zielpfaden. Eine manipulierte Katalogdatei wäre damit ein Primitiv zum
  # Löschen beliebiger Verzeichnisse. Datei-Eingaben genauso prüfen wie
  # CLI-Eingaben.
  case "$id" in
    ''|.|..|*[!a-zA-Z0-9._-]*) hf_err "Katalog: ungültige id '$id'"; return 1 ;;
  esac
  case "$entry" in
    ''|/*|*..*) hf_err "$id: ungültiger entry '$entry' (leer, absolut oder mit '..')"; return 1 ;;
  esac
  case "$extract" in
    zip|targz|gz|none) : ;;
    *) hf_err "$id: unbekannter extract-Typ '$extract'"; return 1 ;;
  esac
  case "$url" in
    https://*) : ;;
    *) hf_err "$id: nur https-Quellen erlaubt, Katalog nennt: $url"; return 1 ;;
  esac

  local asset
  asset=$(printf '%s' "$url" | sed 's#.*/##')

  hf_log ""
  hf_log "  $id $version ($os/$arch) — $purpose"
  hf_info "Quelle:  $url"
  hf_info "Lizenz:  $license"

  # 1. Erwartete Prüfsumme bestimmen
  local expected="" source_label=""
  case "$digest_source" in
    gh-api)
      if [ -z "$JSON_READER" ]; then
        hf_warn "Weder jq noch python3 vorhanden — die GitHub-Angabe ist nicht lesbar."
      else
        expected=$(github_asset_digest "$url" 2>/dev/null | tr -d '[:space:]')
      fi
      source_label="github-release-api"
      ;;
    https://*)
      expected=$(checksum_from_url "$digest_source" "$asset" 2>/dev/null | tr -d '[:space:]')
      source_label="checksum-datei"
      ;;
    none) source_label="keine-veroeffentlicht" ;;
    *) hf_err "$id: unbekannte digest_source '$digest_source'"; return 1 ;;
  esac

  # 2. lock.tsv hat Vorrang, wenn keine Angabe von aussen kommt
  local locked=""
  locked=$(lock_get_artifact "$id" "$os" "$arch" 2>/dev/null) || locked=""

  if [ -z "$expected" ] && [ -n "$locked" ]; then
    expected="$locked"
    source_label="lock.tsv (Trust-on-First-Use)"
    hf_info "Prüfsumme aus lock.tsv (Projekt veröffentlicht keine)."
  fi

  if [ -z "$expected" ]; then
    # Entscheidend ist die DEKLARIERTE Quelle, nicht die Leerheit von
    # $expected. Leer ist es auch, wenn eine gh-api- oder Checksum-Abfrage
    # bloss fehlgeschlagen ist — und die GitHub-API erlaubt unauthentifiziert
    # 60 Anfragen pro Stunde und IP, Rate-Limiting ist also Alltag. Würde
    # --allow-unpinned das mitabdecken, könnte jeder, der die Digest-Abfrage
    # zum Scheitern bringt, einen manipulierten Download in lock.tsv
    # festschreiben lassen — und --verify würde ihn danach bestätigen.
    if [ "$digest_source" != "none" ]; then
      hf_err "$id: Prüfsumme über '$digest_source' nicht abrufbar."
      hf_err "      Mögliche Ursachen: kein Netz, GitHub-Rate-Limit (60/h ohne Token), Asset umbenannt."
      hf_err "      Abbruch. --allow-unpinned gilt NUR für digest_source=none, nicht für fehlgeschlagene Abfragen."
      rm -rf -- "$tmp" 2>/dev/null || true
      return 1
    fi
    if [ "$ALLOW_UNPINNED" -ne 0 ]; then
      hf_err "$id: Projekt veröffentlicht keine Prüfsumme (digest_source=none). Übersprungen."
      hf_err "      Mit --allow-unpinned wird der erste Download in lock.tsv festgeschrieben (Trust-on-First-Use)."
      return 1
    fi
    hf_warn "$id: ohne veröffentlichte Prüfsumme (digest_source=none). Der Hash des Downloads wird in lock.tsv festgeschrieben."
  else
    hf_info "Erwartet: $expected ($source_label)"
  fi

  # 3. Herunterladen
  local tmp
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/hf-fetch-XXXXXX") || { hf_err "$id: kein Temp-Verzeichnis"; return 1; }
  # Heruntergeladenes liegt isoliert und wird nur per Pfad angefasst.
  local dl="$tmp/$asset"

  if ! curl -fsSL --proto '=https' --tlsv1.2 --max-time 900 -o "$dl" "$url"; then
    hf_err "$id: Download fehlgeschlagen: $url"
    rm -rf -- "$tmp"
    return 1
  fi

  # 4. Prüfen
  local actual
  actual=$(hf_sha256_file "$dl" | tr -d '[:space:]')
  if [ -z "$actual" ]; then
    hf_err "$id: Prüfsumme nicht berechenbar."
    rm -rf -- "$tmp"
    return 1
  fi

  if [ -n "$expected" ] && [ "$actual" != "$(printf '%s' "$expected" | LC_ALL=C tr 'A-Z' 'a-z')" ]; then
    hf_err ""
    hf_err "$id: PRÜFSUMME WEICHT AB."
    hf_err "  erwartet: $expected  ($source_label)"
    hf_err "  erhalten: $actual"
    hf_err ""
    if [ "$FORCE" -ne 0 ]; then
      hf_err "  Abbruch. Das ist entweder eine neue Upstream-Version oder eine manipulierte Datei."
      hf_err "  Prüfe die Release-Seite des Projekts. Erst wenn die Abweichung erklärt ist: --force."
      rm -rf -- "$tmp"
      return 2
    fi
    hf_warn "  --force gesetzt: wird akzeptiert und in lock.tsv überschrieben."
  else
    hf_info "Geprüft: $actual"
  fi

  # 5. Entpacken und ablegen
  mkdir -p "$TOOLS_DIR/bin" "$TOOLS_DIR/share"
  local installed=""

  case "$extract" in
    none)
      installed="$TOOLS_DIR/bin/$entry"
      cp -- "$dl" "$installed" && chmod +x "$installed"
      ;;
    gz)
      installed="$TOOLS_DIR/bin/$entry"
      gunzip -c -- "$dl" > "$installed" && chmod +x "$installed"
      ;;
    zip|targz)
      # Erst die Abhängigkeit prüfen: archive_is_safe gibt bei fehlendem unzip
      # ebenfalls 1 zurück, und die Meldung "Archiv enthält '..'" wäre dann
      # eine irreführende Sicherheitswarnung für ein fehlendes Werkzeug.
      if [ "$extract" = "zip" ] && ! command -v unzip >/dev/null 2>&1; then
        hf_err "$id: unzip fehlt — .zip nicht entpackbar."
        rm -rf -- "$tmp"
        return 1
      fi
      if ! archive_is_safe "$dl" "$extract"; then
        hf_err "$id: Archiv enthält Einträge mit '..' oder absolutem Pfad — nicht entpackt."
        rm -rf -- "$tmp"
        return 1
      fi
      local stage="$tmp/stage"
      mkdir -p "$stage"
      if [ "$extract" = "zip" ]; then
        command -v unzip >/dev/null 2>&1 || { hf_err "$id: unzip fehlt."; rm -rf -- "$tmp"; return 1; }
        unzip -q -o -- "$dl" -d "$stage" || { hf_err "$id: Entpacken fehlgeschlagen."; rm -rf -- "$tmp"; return 1; }
      else
        tar -xzf "$dl" -C "$stage" || { hf_err "$id: Entpacken fehlgeschlagen."; rm -rf -- "$tmp"; return 1; }
      fi

      if [ "$entry" = "*" ]; then
        # Ganzer Baum (Regelsammlungen).
        installed="$TOOLS_DIR/share/$id"
        rm -rf -- "$installed"
        mkdir -p "$installed"
        (cd "$stage" && tar -cf - .) | (cd "$installed" && tar -xf -) \
          || { hf_err "$id: Kopieren fehlgeschlagen."; rm -rf -- "$tmp"; return 1; }
      else
        # Genau die benannte Datei — Archive packen sie in unterschiedliche
        # Unterverzeichnisse, deshalb wird gesucht statt geraten.
        local found=""
        found=$(find "$stage" -type f -path "*/$entry" -print -quit 2>/dev/null)
        [ -n "$found" ] || found=$(find "$stage" -type f -name "$(basename -- "$entry")" -print -quit 2>/dev/null)
        if [ -z "$found" ]; then
          hf_err "$id: '$entry' im Archiv nicht gefunden. Katalog-Eintrag veraltet?"
          rm -rf -- "$tmp"
          return 1
        fi
        installed="$TOOLS_DIR/bin/$(basename -- "$entry")"
        cp -- "$found" "$installed" && chmod +x "$installed"
      fi
      ;;
    *)
      hf_err "$id: unbekannter extract-Typ '$extract'"
      rm -rf -- "$tmp"
      return 1
      ;;
  esac

  rm -rf -- "$tmp"

  if [ ! -e "$installed" ]; then
    hf_err "$id: Installation fehlgeschlagen (Ziel fehlt: $installed)"
    return 1
  fi

  # Hash des Installierten getrennt festhalten — bei Archiven ist das eine
  # andere Datei als die heruntergeladene.
  local installed_sha=""
  if [ -d "$installed" ]; then
    installed_sha=$(hf_sha256_tree "$installed" 2>/dev/null)
    [ -n "$installed_sha" ] || installed_sha="UNAVAILABLE"
    installed_sha="tree:$installed_sha"
  else
    installed_sha=$(hf_sha256_file "$installed" 2>/dev/null | tr -d '[:space:]')
    [ -n "$installed_sha" ] || installed_sha="UNAVAILABLE"
  fi

  lock_put "$id" "$os" "$arch" "$version" "$actual" "$source_label" "${installed#"$TOOLS_DIR"/}" "$installed_sha"
  hf_log "  ✓ $id -> $installed"
  return 0
}

# ─── Aktionen ────────────────────────────────────────────────────────────

do_list() {
  printf 'Katalog: %s\n' "$CATALOG"
  printf 'Plattform: %s/%s · Zielverzeichnis: %s\n\n' "$OS" "$ARCH" "$TOOLS_DIR"
  printf '%-22s %-10s %-12s %-10s %s\n' "ID" "VERSION" "STATUS" "PRUEFSUMME" "ZWECK"
  printf '%s\n' '----------------------------------------------------------------------------------------------'
  catalog_rows | while IFS=$(printf '\t') read -r id os arch version url ds extract entry license purpose; do
    status="fehlt"
    if [ -n "$(lock_get_artifact "$id" "$os" "$arch" 2>/dev/null)" ]; then status="installiert"; fi
    # Woher die Pruefsumme kommt, entscheidet, ob --allow-unpinned noetig ist.
    case "$ds" in
      gh-api)    pin="github" ;;
      https://*) pin="datei" ;;
      none)      pin="keine" ;;
      *)         pin="?" ;;
    esac
    printf '%-22s %-10s %-12s %-10s %s\n' "$id" "$version" "$status" "$pin" "$purpose"
  done
  printf '\n'
  printf 'Installieren: %s --install <id>[,<id>...]  oder  --install all\n' "$(basename -- "$0")"
  printf 'Lizenzen und Quellen: references/tools.md\n'
}

do_install() {
  local ids="" rc=0 any=1
  if [ "$WANT" = "all" ]; then
    ids=$(catalog_ids)
  else
    ids=$(printf '%s' "$WANT" | tr ',' '\n')
  fi

  local id
  for id in $ids; do
    [ -n "$id" ] || continue
    # Der Name kommt vom Aufrufer: nur harmlose Zeichen zulassen, bevor er
    # in awk-Vergleiche und Pfade geht.
    case "$id" in
      *[!a-zA-Z0-9._-]*) hf_err "Ungültiger Werkzeugname: $id"; rc=1; continue ;;
    esac

    local rows
    rows=$(catalog_rows | awk -F'\t' -v i="$id" '$1 == i')
    if [ -z "$rows" ]; then
      hf_err "$id: kein Katalog-Eintrag für $OS/$ARCH. '--list' zeigt, was verfügbar ist."
      rc=1
      continue
    fi
    any=0
    local one
    while IFS= read -r one; do
      [ -n "$one" ] || continue
      install_one "$one" || { local r=$?; [ "$r" -gt "$rc" ] && rc=$r; }
    done <<EOF
$rows
EOF
  done

  [ "$any" -eq 0 ] || { hf_err "Nichts installiert."; return 1; }

  hf_log ""
  hf_log "  Prüfsummen: $LOCK"
  hf_log "  Erneut prüfen: $(basename -- "$0") --verify"
  return "$rc"
}

do_verify() {
  if [ ! -f "$LOCK" ]; then
    hf_err "Keine lock.tsv in $TOOLS_DIR — es ist nichts installiert."
    return 1
  fi
  local rc=0 n=0 bad=0
  while IFS=$(printf '\t') read -r id os arch version sha source installed_at path installed_sha; do
    case "$id" in ''|'#'*) continue ;; esac
    n=$((n + 1))
    local full="$TOOLS_DIR/$path"
    if [ ! -e "$full" ]; then
      hf_err "$id: Datei fehlt: $full"
      bad=$((bad + 1)); rc=1; continue
    fi

    local actual=""
    case "$installed_sha" in
      tree:*)
        actual="tree:$(hf_sha256_tree "$full" 2>/dev/null)"
        ;;
      ''|UNAVAILABLE)
        hf_warn "$id: kein installed_sha256 in lock.tsv (Eintrag aus einer älteren Version) — neu installieren, um ihn zu setzen."
        continue
        ;;
      *)
        actual=$(hf_sha256_file "$full" 2>/dev/null | tr -d '[:space:]')
        ;;
    esac

    if [ "$actual" != "$installed_sha" ]; then
      hf_err "$id: Hash des Installierten weicht ab."
      hf_err "   lock.tsv: $installed_sha"
      hf_err "   Datei:    $actual"
      bad=$((bad + 1)); rc=1
    else
      hf_log "  ✓ $id $version (installiert $installed_at, Quelle $source)"
    fi
  done < "$LOCK"
  hf_log ""
  hf_log "  $n Einträge geprüft, $bad abweichend."
  return "$rc"
}

case "$ACTION" in
  list)    do_list ;;
  install) do_install ;;
  verify)  do_verify ;;
esac
