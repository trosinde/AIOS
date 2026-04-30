---
kernel_abi: 2
name: sra-review
description: "Validate a completed Security Risk Assessment (.xlsm + .drawio) against MTOP 212"
category: review
input_type: artifacts
output_type: review_json
tags: [sra, mtop212, iec62443, review, security]
can_follow: [sra-consult-phase]
parallelizable_with: [security_review]
persona: quality_manager
requires:
  reasoning: 7
  code_generation: 5
  instruction_following: 7
  structured_output: 7
  min_context: 12000
output_extraction:
  artifact_pattern: "(?<severity>BLOCKER|WARNING|INFO)[:\\s]+(?<content>.+)"
  artifact_type: finding
  summary_strategy: first_paragraph
---

# AUFGABE
Validiere ein eingereichtes SRA-Paket (`.xlsm` + `.drawio`) gegen MTOP 212.

# VORGEHEN
1. Rufe `agent-sra review <xlsm> --drawio <drawio> -o reviews/<product>/<ts>.json` auf.
2. Validiere das Ergebnis mit `agent-sra validate-schema <out.json>`.
3. Render einen menschenlesbaren Bericht mit `agent-sra report <out.json> -o <out.md>`.
4. Prüfe die `acceptance`:
   - **PASS** → freigeben
   - **WARNINGS** → Liste durchgehen, Findings in Folgetasks adressieren
   - **FAIL** → blocker(s) müssen gefixt werden, kein Markteintritt erlaubt
5. Falls eine Vorgängerversion existiert, lauf `agent-sra diff --prev <old> --new <new> -o <diff.json>` und schlage den Change-Log-Eintrag vor.

# UNVERHANDELBARE REGEL
> Kein Restrisiko in der **Critical** (rot) oder **High** (orange) Klasse für am Markt platzierte Produkte. (MTOP 212 / 5. Risk Assessment Matrix)

# OUTPUT
- `sra_review_v1.json` (kanonisch, schemavalidiert)
- `sra_review_<product>.md` (Bericht für Menschen)
- Bei Diff: `diff.json` + Vorschlag für Change-Log-Eintrag

# HANDOFF
Schließe mit:
```
## Handoff
**Next agent needs:** acceptance verdict, list of blockers/warnings to address, suggested change-log entry
<!-- trace: <trace_id> -->
```
