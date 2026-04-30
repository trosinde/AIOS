---
kernel_abi: 2
name: sra-diff
description: "Diff zwei SRA-Reviews und schlage einen Change-Log-Eintrag mit Major/Minor-Bump vor"
category: review
input_type: review_json_pair
output_type: diff_json
tags: [sra, mtop212, review, diff, change-log]
can_follow: [sra-review]
parallelizable_with: []
persona: release_manager
requires:
  reasoning: 6
  code_generation: 4
  instruction_following: 6
  structured_output: 7
  min_context: 8000
---

# AUFGABE
Vergleiche zwei sra_review_v1-Snapshots und schlage einen Change-Log-Eintrag vor.

# VORGEHEN
1. `agent-sra diff --prev <old.json> --new <new.json> -o diff.json`.
2. Prüfe `risk_elevations` (Pflichteskalation, Major-Bump) und `risk_de_elevations` (Minderung).
3. Übergib den `suggested_change_log_entry`-Block (Version-Bump + Text + Verantwortlich) an den `tech_writer` zur Einarbeitung in das `8. Change Log`-Sheet.

# VERSION-BUMP-HEURISTIK
- **Major**: ≥1 risk_elevating Diff, ODER hinzu/entfernte Asset/Interface/Risk-Entitäten.
- **Minor**: nur methodologisch relevante Modifikationen (CIA-Werte, Counter-Measures, Wording).
- **None**: nur Cosmetic-Diffs (gleiche Inhalte, anderer Hash).

# OUTPUT
- `diff.json`
- Markdown-Snippet für das Change-Log-Sheet im Format `Version | Change reason | Who`

# HANDOFF
```
## Handoff
**Next agent needs:** ready Change-Log entry to be inserted into the .xlsm before the next Review.Validate run
<!-- trace: <trace_id> -->
```
