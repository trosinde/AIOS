# Werkzeuge

Alles hier ist **optional**. Ohne nachgeladene Werkzeuge arbeitet der Skill
mit Bordmitteln; das Ergebnis ist dann schwächer, und das gehört in die
Abdeckungstabelle des Berichts.

Quellen sind ausschliesslich die offiziellen Projekt-Releases. Keine Mirrors,
keine Paketsammlungen Dritter. Die maschinenlesbare Form steht in
`../tools.catalog.tsv`, die Versionen sind dort gepinnt (Stand 2026-11-02).

```bash
bash scripts/fetch-tools.sh --list
bash scripts/fetch-tools.sh --install hayabusa,chainsaw,yara-x
bash scripts/fetch-tools.sh --verify
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fetch-tools.ps1 -List
powershell -ExecutionPolicy Bypass -File scripts\fetch-tools.ps1 -Install hayabusa,chainsaw
```

## Wie die Prüfsummen geprüft werden

| Katalog-Spalte `digest_source` | Bedeutung |
| --- | --- |
| `gh-api` | Die GitHub-Release-API nennt pro Asset ein Feld `digest` (`sha256:…`). Das ist die Angabe des Projekts auf GitHub und wird vor dem Entpacken verglichen. |
| eine URL | Das Projekt veröffentlicht eine Checksum-Datei (z. B. `uac-3.4.0.tar.gz.sha256`). Sie wird geladen und der Hash daraus verglichen. |
| `none` | Das Projekt veröffentlicht keine Prüfsumme. Dann gilt **Trust-on-First-Use**: der Hash des ersten Downloads wird in `tools/lock.tsv` festgeschrieben, jeder spätere Lauf vergleicht dagegen. Ein solcher Download braucht ausdrücklich `--allow-unpinned`. |

`tools/lock.tsv` führt zwei Hashes pro Werkzeug:

- `artifact_sha256` — die heruntergeladene Datei, also das, was gegen die
  Angabe des Projekts geprüft wurde
- `installed_sha256` — was danach in `tools/` liegt. Bei Archiven ist das
  eine **andere** Datei als das Archiv; bei Regelsammlungen ein Baum-Hash
  über die sortierten Datei-Hashes.

Weicht ein erneuter Download ab, bricht `fetch-tools.sh` mit Exit-Code 2 ab.
Das ist Absicht: entweder hat das Projekt eine neue Version unter derselben
URL veröffentlicht, oder die Datei wurde unterwegs verändert. Erst wenn die
Abweichung erklärt ist, hilft `--force`.

**Grenze dieses Verfahrens:** Trust-on-First-Use erkennt eine Veränderung
*nach* dem ersten Download, nicht eine Manipulation *beim* ersten Download.
Wer das ausschliessen muss, lädt die Werkzeuge auf einem separaten,
vertrauenswürdigen Rechner und vergleicht von Hand mit der Release-Seite.

`tools/` und `tools/lock.tsv` gehören zum Arbeitsverzeichnis und nicht ins
AIOS-Repository — die Vorlage trägt sie in `.gitignore` ein.

## Auswertung von Windows-Artefakten (laufen auch unter Linux und in WSL)

| Werkzeug | Zweck | Lizenz | Projekt |
| --- | --- | --- | --- |
| **Hayabusa** | Windows-Eventlogs (.evtx) zu einer Sigma-basierten Timeline. Schnell, gute Standardregeln. | AGPL-3.0 | [Yamato-Security/hayabusa](https://github.com/Yamato-Security/hayabusa) |
| **Chainsaw** | Eventlog-Hunting mit Sigma-Regeln, zusätzlich eigene Erkennungsregeln und Shimcache/SRUM-Parser. | GPL-3.0 | [WithSecureLabs/chainsaw](https://github.com/WithSecureLabs/chainsaw) |
| **RegRipper** | Registry-Hives auswerten (Autostarts, USB-Geräte, Nutzerspuren). Perl, kein Release-Artefakt — per `git clone`. | MIT | [keydet89/RegRipper3.0](https://github.com/keydet89/RegRipper3.0) |
| **plaso** | Super-Timeline über viele Artefakttypen (`log2timeline.py`, `psort.py`). Per `pip` oder Docker, kein portables Binary. | Apache-2.0 | [log2timeline/plaso](https://github.com/log2timeline/plaso) |
| **Volatility 3** | Speicherabbilder analysieren. Python-Wheel; für Windows gibt es ein gepacktes `vol.exe`. | VSL-1.0 | [volatilityfoundation/volatility3](https://github.com/volatilityfoundation/volatility3) |

RegRipper und plaso stehen **nicht** im Katalog, weil sie keine portablen
Release-Binaries veröffentlichen. Installation:

```bash
# RegRipper (Perl)
git clone https://github.com/keydet89/RegRipper3.0 "$HOST_FORENSICS_TOOLS/share/regripper"
# Aufruf: perl "$HOST_FORENSICS_TOOLS/share/regripper/rip.pl" -r SYSTEM -f system

# plaso — eigene virtuelle Umgebung, damit nichts ins System gerät
python3 -m venv "$HOST_FORENSICS_TOOLS/share/plaso-venv"
"$HOST_FORENSICS_TOOLS/share/plaso-venv/bin/pip" install plaso

# Volatility 3
python3 -m venv "$HOST_FORENSICS_TOOLS/share/vol3-venv"
"$HOST_FORENSICS_TOOLS/share/vol3-venv/bin/pip" install volatility3
```

## Sammlung und Live-Abfrage

| Werkzeug | Zweck | Lizenz | Projekt |
| --- | --- | --- | --- |
| **Velociraptor** | Offline-Collector; liest gesperrte Dateien (Eventlogs, Registry-Hives, `$MFT`) roh vom Laufwerk und packt sie in ein ZIP. Ein einzelnes Binary, kein Server nötig. | AGPL-3.0 | [Velocidex/velociraptor](https://github.com/Velocidex/velociraptor) |
| **UAC** | Artefakt-Sammler für Unix-artige Systeme (Linux, macOS, BSD, Solaris, AIX). Profilgesteuert, rein Shell. | Apache-2.0 | [tclahr/uac](https://github.com/tclahr/uac) |
| **osquery** | Systemzustand per SQL abfragen. Gut für gezielte Prüffragen, siehe `triage-checklist.md`. | Apache-2.0 / GPL-2.0 | [osquery/osquery](https://github.com/osquery/osquery) |
| **Autoruns** (`autorunsc64.exe`) | Autostart-Inventar für Windows in einem Durchgang, inklusive Signaturprüfung. Nur Windows. | Sysinternals EULA | [Microsoft Sysinternals](https://learn.microsoft.com/sysinternals/downloads/autoruns) |

Velociraptor veröffentlicht neben den Binaries `.sig`-Dateien (minisign),
keine SHA-256-Datei. Der Katalog nutzt deshalb die Digest-Angabe der
Release-API. Wer die Signatur selbst prüfen will, braucht `minisign` und den
öffentlichen Schlüssel des Projekts.

## Speicherabbild

| Werkzeug | Plattform | Lizenz | Projekt |
| --- | --- | --- | --- |
| **AVML** | Linux. Schreibt ein LiME-Format-Abbild ohne Kernel-Modul. | MIT | [microsoft/avml](https://github.com/microsoft/avml) |
| **WinPmem** | Windows. `winpmem_mini_x64_rc2.exe` ist das signierte Mini-Binary. | Apache-2.0 | [Velocidex/WinPmem](https://github.com/Velocidex/WinPmem) |

**macOS:** Für aktuelle Versionen gibt es kein gepflegtes freies Werkzeug für
ein vollständiges Speicherabbild — SIP verhindert den nötigen Kernel-Zugriff.
`collect.sh` vermerkt das als Lücke. Ersatzweise bleiben Prozess-Dumps
einzelner verdächtiger PIDs, und das nur mit ausdrücklichem Auftrag.

## Malware-Erkennung

| Werkzeug | Zweck | Lizenz | Projekt |
| --- | --- | --- | --- |
| **YARA-X** | Nachfolger von YARA, Binary heisst `yr`. Wendet Regeln auf Dateien an. | BSD-3-Clause | [VirusTotal/yara-x](https://github.com/VirusTotal/yara-x) |
| **YARA Forge** | Kuratierte Regelsammlung aus vielen öffentlichen Quellen, in drei Paketen: `core` (wenig Falschalarme), `extended`, `full`. | gemischt, siehe `yara-forge-log.txt` im Release | [YARAHQ/yara-forge](https://github.com/YARAHQ/yara-forge) |
| **ClamAV** | Offener Virenscanner mit eigenen Signaturen; `freshclam` aktualisiert sie. Über die Paketverwaltung, nicht über diesen Katalog. | GPL-2.0 | [clamav.net](https://www.clamav.net/) |

Nach `fetch-tools.sh --install yara-forge-core` liegen die Regeln unter:

```text
$HOST_FORENSICS_TOOLS/share/yara-forge-core/packages/core/yara-rules-core.yar
```

Anwendung und Umgang mit Falschalarmen: `malware-scan.md`.

## Was absichtlich fehlt

- **Werkzeuge, die das System verändern.** Keine Entferner, keine
  Quarantäne-Funktionen, keine Rootkit-Remover. Der Skill schlägt Massnahmen
  vor, er führt sie nicht aus.
- **Kommerzielle Pakete** (EnCase, X-Ways, Magnet AXIOM). Wer sie hat, nutzt
  sie — der Fallordner mit Manifest ist ein brauchbarer Ausgangspunkt dafür.
- **Eric Zimmerman Tools** (PECmd, MFTECmd, AmcacheParser …). Sehr nützlich
  für Windows-Artefakte, werden aber nicht über ein stabiles Release-Asset mit
  Prüfsumme verteilt, sondern über `Get-ZimmermanTools.ps1`. Wer sie einsetzt,
  lädt sie manuell nach `$HOST_FORENSICS_TOOLS/bin` und vermerkt im Bericht,
  dass die Herkunft nicht automatisch geprüft wurde.
