---
kernel_abi: 2
name: sra-consult-assets
description: "Schlage einen Startsatz an Data Assets für die PNA basierend auf dem Produktkontext vor"
category: consultation
input_type: product_context
output_type: pna_suggestions
tags: [sra, mtop212, consulting, assets, pna]
can_follow: []
parallelizable_with: [sra-consult-topology]
persona: security_expert
requires:
  reasoning: 6
  code_generation: 3
  instruction_following: 6
  structured_output: 7
  min_context: 8000
---

# AUFGABE
Erzeuge einen sinnvoll vorausgefüllten Startsatz für die Protection Need Analysis aus dem Produktkontext.

# VORGEHEN
1. Hole vom Team einen JSON-Produktkontext (`product_type`, `intended_use`, `business_unit`, `project_name`, optional `free_text`).
2. Rufe `agent-sra consult-assets --product context.json -o suggestions.json` auf.
3. Präsentiere dem Team die Vorschlagsliste in einer Markdown-Tabelle mit Spalten: Asset | Owner | Data Type | C | I | A | Begründung-C | Begründung-I | Begründung-A.
4. Markiere **baseline-Assets** (immer enthalten: MT Device Specific Data, MT Log Files, MT Software Artifacts, Third Party Artifacts) klar.
5. Erkläre: Werte sind **Defaults**, das Team muss prüfen und ggf. anpassen.

# REGELN
- Nutze ausschließlich die kanonische 9-Asset-Liste aus dem MT-Standard (`src/consult/asset_catalogue.py`).
- Schlage **keine** Custom-Assets vor — verwende stattdessen die kanonischen Namen.
- Bei high-Integrity-Assets erwähne immer den möglichen Safety/Health-Bezug in der Begründung (für PNA-002-Konformität).

# OUTPUT
- `suggestions.json` (parsable)
- Begleit-Markdown mit der Tabelle und einer Empfehlung welche Assets typischerweise zu streichen sind, wenn das Produkt z. B. keine UI hat (→ keine Customer Personal Data).

# HANDOFF
```
## Handoff
**Next agent needs:** confirmed asset list, ready for PNA Excel population (Phase 2 of sra-consult-phase)
<!-- trace: <trace_id> -->
```
