#!/usr/bin/env bash
#
# AIOS host-forensics — Funktionsnachweis mit harmlosen Testfunden.
#
# Legt in einem Spielwiesen-Verzeichnis Dateien ab, die die Prüfung finden
# MUSS. Wenn sie nicht gefunden werden, ist nicht das System sauber, sondern
# die Prüfung kaputt.
#
# Was angelegt wird:
#   1. EICAR-Testdatei            — muss von ClamAV/Defender/XProtect erkannt werden
#   2. ausführbares Skript in /tmp — muss in filesystem/temp-executables auftauchen
#   3. Datei mit Tabulator im Namen — muss in den Dateilisten "Q:"-markiert sein
#   4. versteckte ausführbare Datei im Home — muss in home-hidden-executables stehen
#
# Es werden KEINE Autostart-Einträge, Dienste oder Registry-Schlüssel
# angelegt: das wäre eine Veränderung am System und widerspricht der
# Grundregel des Skills. Den Autostart-Test macht man von Hand und entfernt
# ihn danach selbst.
#
# Verwendung:
#   selftest.sh --dir /tmp/hf-selftest          # anlegen
#   selftest.sh --dir /tmp/hf-selftest --clean  # wieder entfernen
#
# Exit-Codes: 0 = fertig, 1 = Abbruch.

set -uo pipefail

# CDPATH= setzt die Variable nur fuer dieses cd: ein gesetztes CDPATH
# wuerde sonst in ein ganz anderes Verzeichnis wechseln.
# shellcheck disable=SC1007
HF_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$HF_SCRIPT_DIR/lib.sh"

DIR=""
CLEAN=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)   DIR="${2:-}"; [ -n "$DIR" ] || hf_die "--dir braucht einen Pfad"; shift 2 ;;
    --clean) CLEAN=0; shift ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) hf_die "Unbekannte Option: $1" ;;
  esac
done

[ -n "$DIR" ] || hf_die "--dir fehlt. Beispiel: --dir /tmp/hf-selftest"

case "$DIR" in
  /|/bin|/boot|/dev|/etc|/home|/lib|/proc|/root|/sbin|/sys|/usr|/var|/Users|/Applications|/System|/Library)
    hf_die "Verweigert: $DIR ist ein Systemverzeichnis. Nimm ein eigenes Verzeichnis, z. B. /tmp/hf-selftest." ;;
esac

if [ "$CLEAN" -eq 0 ]; then
  if [ ! -d "$DIR" ]; then
    hf_log "Nichts zu entfernen: $DIR existiert nicht."
    exit 0
  fi
  rm -rf -- "$DIR"
  rm -f -- "$HOME/.hf-selftest-hidden" 2>/dev/null || true
  hf_log "Entfernt: $DIR und \$HOME/.hf-selftest-hidden"
  exit 0
fi

mkdir -p "$DIR" || hf_die "Verzeichnis nicht anlegbar: $DIR"

# ─── 1. EICAR ────────────────────────────────────────────────────────────
#
# Die Signatur wird zur Laufzeit aus Teilen zusammengesetzt. Stünde sie als
# Ganzes in dieser Datei, würde jeder Virenscanner dieses Repository
# quarantänisieren — und das Skript wäre nutzlos.

eicar_part1='X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR'
eicar_part2='-STANDARD-ANTIVIRUS-TEST-FILE!$H+H'
printf '%s%s%s' "$eicar_part1" "$eicar_part2" '*' > "$DIR/eicar-test.txt"

# ─── 2. Ausführbares in einem Temp-Pfad ──────────────────────────────────

cat > "$DIR/hf-selftest-marker.sh" <<'MARKER'
#!/bin/sh
# AIOS host-forensics Selbsttest-Marker. Tut nichts. Sicher zu löschen.
echo "aios-host-forensics-selftest"
MARKER
chmod +x "$DIR/hf-selftest-marker.sh"

# ─── 3. Steuerzeichen im Dateinamen ──────────────────────────────────────

odd_name=$(printf 'hf-selftest\tcontrolchar.txt')
printf 'Dateiname enthält einen Tabulator. Im Manifest muss die Zeile mit "Q:" beginnen.\n' \
  > "$DIR/$odd_name" 2>/dev/null \
  || hf_warn "Datei mit Tabulator im Namen nicht anlegbar (Dateisystem erlaubt es nicht) — Test 3 entfällt."

# ─── 4. Versteckte ausführbare Datei im Home ─────────────────────────────

if printf '#!/bin/sh\n# AIOS host-forensics Selbsttest. Tut nichts.\n' > "$HOME/.hf-selftest-hidden" 2>/dev/null; then
  chmod +x "$HOME/.hf-selftest-hidden" 2>/dev/null \
    || hf_warn "Versteckte Datei im Home angelegt, aber nicht ausführbar gesetzt — Test 4 greift nur teilweise."
else
  hf_warn "Versteckte Datei im Home nicht anlegbar — Test 4 entfällt."
fi

# ─── Erwartung ausgeben ──────────────────────────────────────────────────

cat <<EXPECT

Testfunde angelegt in: $DIR

Erwartung — die Prüfung MUSS diese vier Dinge zeigen:

  1. Virenscan      $DIR/eicar-test.txt
                    ClamAV: Eicar-Signature / Defender: Virus:DOS/EICAR_Test_File
                    Erscheint das NICHT, ist der Scanner nicht aktiv oder
                    scannt diesen Pfad nicht — das ist eine Lücke, kein "sauber".

  2. Dateiprüfung   $DIR/hf-selftest-marker.sh
                    in filesystem/temp-executables.tsv (wenn $DIR unter /tmp liegt)
                    oder über --extra-dir "$DIR"

  3. Dateilisten    Zeile für "hf-selftest<TAB>controlchar.txt" beginnt mit "Q:"
                    in filesystem/extra-*.tsv bzw. filesystem/temp-executables-*.tsv.
                    Steht der Pfad dort ungequotet, zerstört ein präparierter
                    Dateiname die Spalten — dann ist die Auswertung unzuverlässig.
                    Ein Dateiname mit Steuerzeichen ist ausserdem selbst ein
                    Befund und gehört in den Bericht.

  4. Home-Prüfung   \$HOME/.hf-selftest-hidden
                    in filesystem/home-hidden-executables.tsv

Nicht getestet (würde das System verändern und ist deshalb nicht Teil des Skills):
  - Autostart-Eintrag: von Hand anlegen, prüfen, von Hand entfernen
  - Dienst / systemd-Unit: dito
  - Registry-Run-Key unter Windows: dito

Aufräumen:
  $0 --dir $DIR --clean

Wichtig für den Bericht: EICAR ist ein Funktionsnachweis, kein Befund. Es
gehört in den Abdeckungs-Abschnitt, nicht in die Befundtabelle.

EXPECT
