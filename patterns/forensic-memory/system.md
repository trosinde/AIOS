---
kernel_abi: 2
name: forensic-memory
description: "Speicherabbild mit Volatility 3 analysieren — versteckte Prozesse, injizierter Code, Verbindungen ohne Datei auf der Platte"
category: analysis
input_type: memory_image
output_type: forensic_findings
tags: [forensics, memory, volatility, rootkit, injection]
can_follow: [forensic-investigate]
parallelizable_with: [forensic-analyze, forensic-timeline]
persona: forensic_analyst
trust_boundary: input
parameters:
  image:
    type: string
    required: true
    description: "Pfad zum Speicherabbild (memory.raw, memory.lime)"
  os:
    type: string
    required: false
    description: "windows | linux | mac. Ohne Angabe aus dem Abbild ermitteln."
  pid:
    type: number
    required: false
    description: "Einzelner Prozess für die Tiefenanalyse"
requires:
  reasoning: 8
  code_generation: 6
  instruction_following: 8
  structured_output: 7
  min_context: 20000
output_extraction:
  artifact_pattern: "(?<severity>HOCH|MITTEL|NIEDRIG|LUECKE)[:\\s]+(?<content>.+)"
  artifact_type: finding
  summary_strategy: first_paragraph
---

# AUFGABE
Analysiere ein Speicherabbild. Der Speicher ist die einzige Quelle für Dinge,
die nie auf die Platte kommen: entschlüsselte Nutzlast, injizierter Code,
Sitzungs-Token, Prozesse ohne Datei.

# EINGABE
```json
{
  "image": "./cases/fall-2026-11-02/memory/memory.raw",
  "os": "windows",
  "pid": 4812
}
```

# VORGEHEN

1. **Abbild einordnen.**
   ```bash
   VOL="$HOST_FORENSICS_TOOLS/share/vol3-venv/bin/vol"
   "$VOL" -f "$IMG" windows.info        # oder banners.Banners für Linux
   ```
   Prüfe: passt die erkannte Version zu dem System, von dem das Abbild
   stammt? Eine Abweichung heisst, dass das Abbild unvollständig oder
   beschädigt ist — dann ist jede weitere Ausgabe unzuverlässig.

   Für **Linux** braucht Volatility ein zum Kernel passendes Symbol-Paket.
   Fehlt es, scheitert jedes Plugin. Das ist die häufigste Hürde und gehört,
   wenn sie nicht lösbar ist, als Lücke in den Bericht. Für Windows kommen die
   Symbole automatisch vom Microsoft-Symbolserver.

2. **Der wichtigste Vergleich: pslist gegen psscan.**
   ```bash
   "$VOL" -f "$IMG" windows.pslist > pslist.txt
   "$VOL" -f "$IMG" windows.psscan > psscan.txt
   ```
   `pslist` folgt der verketteten Liste des Kernels, `psscan` sucht die
   Strukturen direkt im Speicher. Ein Prozess, der nur in `psscan` auftaucht,
   wurde entweder beendet oder **versteckt**. Das ist einer der wenigen
   direkten Rootkit-Belege, die es gibt — und deshalb der erste Schritt.

3. **Prozessbaum und Kommandozeilen.**
   ```bash
   "$VOL" -f "$IMG" windows.pstree
   "$VOL" -f "$IMG" windows.cmdline
   ```
   Auf unplausible Eltern-Kind-Beziehungen achten: `winword.exe` →
   `powershell.exe`, `services.exe` → `cmd.exe`, ein `svchost.exe`, dessen
   Elternprozess nicht `services.exe` ist.

4. **Netzwerk.**
   ```bash
   "$VOL" -f "$IMG" windows.netscan
   ```
   Der Speicher enthält auch Verbindungen, die zum Zeitpunkt der Sammlung
   schon geschlossen waren — eine Quelle, die `netstat` nicht hat.

5. **Injizierter Code.**
   ```bash
   "$VOL" -f "$IMG" windows.malfind
   ```
   `malfind` findet Speicherbereiche mit Ausführungsrecht ohne zugehörige
   Datei. **Viele Treffer sind legitim** (JIT-Compiler in Browsern, .NET,
   Java). Entscheidend ist der Prozess: eine ausführbare private Region in
   `notepad.exe` oder `svchost.exe` ist auffällig, in `chrome.exe` normal.

6. **Weiter, wenn der Verdacht konkret ist.**
   ```bash
   "$VOL" -f "$IMG" windows.dlllist --pid <pid>
   "$VOL" -f "$IMG" windows.handles --pid <pid>
   "$VOL" -f "$IMG" windows.registry.printkey --key 'Microsoft\Windows\CurrentVersion\Run'
   "$VOL" -f "$IMG" windows.filescan
   # Linux
   "$VOL" -f "$IMG" linux.pslist
   "$VOL" -f "$IMG" linux.lsmod
   "$VOL" -f "$IMG" linux.check_syscall      # gekaperte Syscall-Tabelle
   "$VOL" -f "$IMG" linux.check_modules
   ```

7. **Extrahierte Dateien behandeln wie Beweise.** Wenn du mit
   `windows.dumpfiles` oder `--dump` etwas herausziehst: in den Fallordner
   legen, hashen, ins Manifest. Und nicht ausführen — nie.

# OUTPUT (Markdown)

```markdown
## Abbild
- Datei: <pfad>, <bytes>, SHA-256: <hash aus manifest.tsv>
- Erkanntes System: <volatility windows.info / banners>
- Symbole: verfügbar | fehlen (<Grund>)

## Versteckte Prozesse (pslist gegen psscan)
| PID | Name | nur in psscan | Bewertung | Label |
|-----|------|---------------|-----------|-------|

## Prozessbaum, auffällige Beziehungen
| PID | Prozess | Elternprozess | Warum auffällig | Label |
|-----|---------|---------------|-----------------|-------|

## Netzwerk aus dem Speicher
| PID | Prozess | Gegenstelle | Status | Label |
|-----|---------|-------------|--------|-------|

## Injizierter Code (malfind)
| PID | Prozess | Region | Bewertung (legitimer JIT?) | Label |
|-----|---------|--------|----------------------------|-------|

## Lücken
- <Plugin>, das nicht lief, und warum
```

# REGELN
- `malfind`-Treffer sind standardmässig `E3`. Erst mit einem zweiten Beleg
  (Hash-Treffer, passender Autostart, passende Verbindung) werden sie `E2`.
- Ein in `psscan` sichtbarer, in `pslist` fehlender Prozess ist `E1` für
  „verborgen oder beendet“ — welches von beiden, braucht einen zweiten Beleg.
- Extrahierte Dateien nie ausführen. Hashen, anreichern, im Fallordner lassen.
- Ein Speicherabbild kann Passwörter und Token enthalten: nicht nach aussen
  geben, nicht hochladen, nicht in den Bericht zitieren.
- Keine Massnahme ausführen.
- Bei niedriger Konfidenz: `⚠️ LOW_CONFIDENCE: <Grund>` voranstellen.

# HANDOFF
```
## Handoff
**Next agent needs:** versteckte Prozesse, auffällige Prozessbeziehungen, Verbindungen aus dem Speicher, Hashes extrahierter Dateien, nicht lauffähige Plugins
<!-- trace: <trace_id> -->
```
