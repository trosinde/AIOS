# Anreicherung von aussen

## Die Regel

**Nur Hashes gehen nach aussen. Nie Dateien.**

Warum das kein Formalismus ist:

- Eine hochgeladene Datei kann Geschäftsgeheimnisse, Zugangsdaten oder
  personenbezogene Daten enthalten. Bei VirusTotal ist eine Einreichung für
  andere zahlende Nutzer herunterladbar — eine Preisgabe, die nicht
  rückholbar ist.
- Ein Upload kann eine Meldepflicht auslösen (DSGVO Art. 33) oder einen
  Vertrag brechen.
- Ein Hash-Lookup ist für den Angreifer sichtbar, **wenn er die Datei selbst
  eingereicht hat**: er sieht an der Abfragestatistik, dass jemand sucht. Das
  ist ein Grund, vor der ersten Abfrage zu fragen — nicht ein Grund, es zu
  lassen.

Deshalb: vor der ersten Abfrage den Nutzer fragen. Und nie Pfade mit
Nutzernamen, keine Logauszüge, keine Hostnamen mitsenden.

## Dienste

| Dienst | Abfrage | Schlüssel | Grenze |
| --- | --- | --- | --- |
| **VirusTotal** | `GET https://www.virustotal.com/api/v3/files/<sha256>` | `x-apikey`, kostenlos 4 Abfragen/Minute, 500/Tag | Freier Schlüssel ist für die Community sichtbar |
| **MalwareBazaar** | `POST https://mba-api.abuse.ch/api/v1/` mit `query=get_info&hash=<sha256>` | `Auth-Key`, kostenlos nach Registrierung | Deckt vor allem aktuelle Kampagnen ab |
| **CIRCL hashlookup** | `GET https://hashlookup.circl.lu/lookup/sha256/<hash>` | keiner | Nur bekannte **gute** Dateien (NSRL u. a.) |

CIRCL ist das nützlichste und am wenigsten heikle: ein Treffer bedeutet „diese
Datei gehört zu einer bekannten Software-Verteilung“ und nimmt sie aus der
Prüfliste. Das reduziert die Arbeit oft um den grössten Teil.

## Abfragen

```bash
CASE=./cases/fall-2026-11-02
mkdir -p "$CASE/analysis"

# 1. Welche Hashes sind bekannt gut? (ohne Schlüssel, unkritisch)
cut -f2 "$CASE/hashes/process-binaries.tsv" | grep -E '^[0-9a-f]{64}$' | sort -u \
| while read -r h; do
    r=$(curl -fsSL --proto '=https' --max-time 20 \
         "https://hashlookup.circl.lu/lookup/sha256/$h" 2>/dev/null)
    if [ -n "$r" ]; then printf '%s\tBEKANNT_GUT\n' "$h"
    else                 printf '%s\tUNBEKANNT\n'  "$h"; fi
  done > "$CASE/analysis/hashlookup.tsv"

# 2. Nur die unbekannten bei VirusTotal nachfragen
grep UNBEKANNT "$CASE/analysis/hashlookup.tsv" | cut -f1 \
| while read -r h; do
    curl -fsSL --proto '=https' --max-time 30 \
      -H "x-apikey: $VT_API_KEY" \
      "https://www.virustotal.com/api/v3/files/$h" \
    | python3 -I -c '
import json, sys
try:
    d = json.load(sys.stdin)["data"]["attributes"]
except Exception:
    sys.exit(0)
s = d.get("last_analysis_stats", {})
names = d.get("popular_threat_classification", {}).get("suggested_threat_label", "")
print("%s\t%s/%s\t%s" % (
    d.get("sha256", "?"),
    s.get("malicious", 0),
    sum(v for v in s.values() if isinstance(v, int)),
    names or "-"))
'
    sleep 16   # freier Schlüssel: 4 Abfragen pro Minute
  done > "$CASE/analysis/virustotal.tsv"
```

`python3 -I` läuft im isolierten Modus: so kann ein `json.py`, das jemand in
das aktuelle Verzeichnis gelegt hat, nicht statt des Standardmoduls geladen
werden. Bei einem Forensik-Werkzeug ist das keine Theorie.

Schlüssel über Umgebungsvariablen (`VT_API_KEY`, `MB_API_KEY`), nie als
Argument auf der Kommandozeile — dort landet er in der Prozessliste und in
der Shell-Historie.

## Bewertung der Ergebnisse

| Ergebnis | Label | Begründung |
| --- | --- | --- |
| Viele übereinstimmende Urteile, benannte Familie | `E1` | Eindeutige Zuordnung |
| VirusTotal-Treffer **und** lokaler Scanner-Treffer | `E2` | Zwei unabhängige Quellen |
| Einzelnes Urteil einer Engine | `E3` | Oft eine Heuristik; Falschalarm möglich |
| Nicht bekannt | `U` | **Kein Freispruch.** Gezielte Schadsoftware ist dort regelmässig unbekannt. |
| CIRCL kennt die Datei als gut | `E1` (entlastend) | Teil einer bekannten Software-Verteilung |

Ein „0/70“ bei VirusTotal heisst: keine der Engines kennt diese Datei. Bei
einer Datei, die seit Jahren Teil des Betriebssystems ist, wäre das seltsam;
bei einer Datei, die vor zwei Tagen in `%TEMP%` aufgetaucht ist, ist es genau
das, was man bei einem gezielten Angriff erwartet.

## Was nicht nach aussen geht

- Dateien und Dateiinhalte
- Pfade, die Nutzernamen enthalten (`C:\Users\max.mustermann\…`)
- Hostnamen, interne IP-Adressen, Domänennamen
- Logauszüge, Eventlog-Exporte, Speicherabbilder
- E-Mail-Adressen, Seriennummern, Lizenzschlüssel

Wenn eine Datei wirklich eine Tiefenanalyse braucht: in einer eigenen,
abgeschotteten Umgebung untersuchen, nicht hochladen. Und das als Entscheidung
mit dem Nutzer treffen, nicht nebenbei.

## IP-Adressen und Domains

Für Verbindungen aus `volatile/net-*.csv` gilt dasselbe Prinzip: die
**Gegenstelle** darf abgefragt werden, der eigene Rechner nicht.

```bash
# Reverse-DNS, ohne Dritte
dig +short -x 203.0.113.42
# Wem gehört das Netz
whois 203.0.113.42 | grep -iE 'orgname|netname|country|descr' | head -5
```

Weitergehende Dienste (Shodan, AbuseIPDB, urlscan) sind sinnvoll, aber
kostenpflichtig oder kontingentiert und senden die Ziel-IP an einen Dritten.
Vor dem Einsatz dieselbe Frage wie oben: ist das abgestimmt?

**Vorsicht beim Nachsehen:** Eine verdächtige URL **nicht** im Browser
aufrufen und nicht direkt mit `curl` abholen. Das bestätigt dem Angreifer,
dass seine Infrastruktur beobachtet wird, und kann weitere Nutzlast
nachladen. Wenn Inhalt nötig ist: `urlscan.io` oder ein Archiv-Snapshot.
