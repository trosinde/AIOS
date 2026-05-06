---
kernel_abi: 2
name: doc-consult-product
description: "Mehrdeutige Produktbegriffe gegen die kanonische Familienliste auflösen (config/product_families.json)"
category: consultation
input_type: ambiguous_product_term
output_type: product_family_resolution
tags: [documentation, taxonomy, product-families, consulting, labtec]
can_follow: []
parallelizable_with: [doc-query]
persona: agent_documentation
parameters:
  term:
    type: string
    required: true
    description: "Mehrdeutiger Produktbegriff aus einer User-Anfrage (z. B. 'PFS-ONE', 'AX-MMC', 'WXTS')"
  context:
    type: string
    required: false
    description: "Optionaler Kontext (z. B. die ursprüngliche User-Frage), um zwischen Aliases zu disambiguieren"
requires:
  reasoning: 6
  code_generation: 1
  instruction_following: 6
  structured_output: 7
  min_context: 4000
---

# AUFGABE
Löse einen mehrdeutigen Produktbegriff gegen die kanonische Liste in `config/product_families.json` (51 Familien) auf. Liefere eine eindeutige Familie + Konfidenz, oder eine Disambiguierungs-Frage, wenn keine eindeutige Auflösung möglich ist.

# ⛔ HARTE REGEL — NICHT VERHANDELBAR

**Es werden NIEMALS Familien erfunden.** Resolution kommt ausschließlich aus `config/product_families.json`. Wenn der Begriff dort nicht abbildbar ist (auch nicht über Aliases), melde das als Lücke an den Curator (`doc-ambiguity-detected`) — nicht raten.

# VORGEHEN (intern)
1. Lies `config/product_families.json` ein.
2. Suche nach exaktem Match, dann Alias-Match, dann Substring/Fuzzy-Match.
3. Beachte bekannte Mappings (öffentlicher Name ↔ Archiv-SKU):
   - `AX` (Archiv) ↔ `AX-MMC` / `AX-AMC` (mt.com Public)
   - `WXTS` und `WXTJ` sind eine 3DU-Familie (zusammen behandeln)
   - `PFS-ONE` (mt.com) ↔ `PWSone_Plus` (Archiv-Folder 30357061E)
   Diese Mappings stehen im persistenten MEMORY — `product_families.json` bleibt aber authoritativ. Bei Konflikt zwischen MEMORY und JSON gewinnt das JSON.
4. Bei mehreren Kandidaten mit ähnlicher Konfidenz und vorhandenem `context`: nutze `context`, um zu disambiguieren.

# OUTPUT (an den Aufrufer)
Strukturierte Resolution:
- `resolved_family`: kanonischer Name aus `product_families.json` (oder `null`, wenn nicht eindeutig)
- `confidence`: `high` | `medium` | `low`
- `match_type`: `exact` | `alias` | `fuzzy` | `mapped`
- `notes`: kurze Begründung, ggf. Verweis auf MEMORY-Mapping
- `alternatives`: bis zu 3 weitere mögliche Kandidaten (bei `confidence < high`)

Bei `confidence == low` oder mehreren gleichberechtigten Kandidaten: stelle eine konkrete Disambiguierungs-Frage an den Aufrufer, statt zu raten.

# REGELN
- `product_families.json` ist die einzige Quelle für gültige Familien.
- Aliases nur anwenden, wenn sie dort dokumentiert sind ODER als persistentes MEMORY-Mapping bekannt sind.
- Keine Familie erfinden — bei Lücke: `null` + `doc-ambiguity-detected`-Event-Hinweis.
- Begründung mit Pfadangabe (z. B. "Match via Alias `axmmc` in product_families.json:42").

# HANDOFF
```
## Handoff
**Next agent needs:** resolved_family (oder Disambiguierungs-Frage); doc-query kann mit `--product <resolved_family>` weitermachen
<!-- trace: <trace_id> -->
```
