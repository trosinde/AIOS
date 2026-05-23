---
kernel_abi: 2
name: doc-query
description: "Semantische Suche im LabTec-PDF-Archiv — natürlichsprachliche Frage → Top-K-Treffer mit SharePoint-Links"
category: extract
input_type: natural_language_query
output_type: search_hits
tags: [documentation, rag, semantic-search, labtec, sharepoint]
can_follow: [doc-consult-product]
parallelizable_with: []
persona: agent_documentation
parameters:
  query:
    type: string
    required: true
    description: "Natürlichsprachliche Frage (DE oder EN)"
  product:
    type: string
    required: false
    description: "Kanonische Produktfamilie aus config/product_families.json"
  doc_type:
    type: string
    required: false
    description: "Kurzcode aus dem Archiv. Häufig (mit Index-Counts): RM (Reference Manual, 4584), OI (Operating Instructions, 701), UM (User Manual, 370), generic (194), INI (Instructions, 42), DoC (Declaration of Conformity, 22), SUP (Support, 13), SMA (10), QG (Quick Guide, 7), SoD (4), CHM (Compiled Help, 1), MISC (1). Authoritative: SELECT DISTINCT doc_type FROM chunks."
  top_k:
    type: integer
    required: false
    default: 8
    description: "Anzahl der zurückzuliefernden Treffer"
  language:
    type: string
    required: false
    default: "auto"
    description: "Anfragesprache; 'auto' detektiert aus der Query"
requires:
  reasoning: 5
  code_generation: 2
  instruction_following: 6
  structured_output: 7
  min_context: 6000
---

# AUFGABE
Beantworte eine natürlichsprachliche Frage über das LabTec-PDF-Archiv mit Top-K-Treffern aus der SQLite-Vektor-DB. Keine Halluzination — Antwort basiert ausschließlich auf den Skript-Treffern.

# ⛔ HARTE REGEL — NICHT VERHANDELBAR

**Treffer werden NIEMALS aus dem Modellwissen erfunden.** Sie kommen ausschließlich aus `scripts/semantic_search.py` (Vektor-DB `data/vectors.db`). Wenn das Skript fehlschlägt oder nichts liefert, melde das ehrlich und stoppe — generiere keine Ersatztreffer. SharePoint-URLs aus dem Modellgedächtnis sind verboten.

# VORGEHEN (intern)
1. Erkenne Sprache der Query. Bei Nicht-Englisch: übersetze intern ins Englische, merke die Originalsprache für die Antwort.
2. Wenn der Produktbegriff in der Query mehrdeutig ist: triggere zuerst `doc-consult-product` und nimm dessen Resolution als `--product`-Filter.
3. Rufe:
   ```bash
   python scripts/semantic_search.py \
     '<en-query>' \
     --top-k <top_k> \
     --json \
     [--product <product> [--product <product2>]] \
     [--doc-type <RM|OI|UM|INI|DoC|SUP|SMA|QG|SoD|CHM|generic|MISC>]
   ```
   Hinweise:
   - `query` ist **positional** (kein `--query`-Flag).
   - `--product` ist repeatable.
   - `--json` für strukturiertes Parsen verwenden.
4. Parse die JSON-Trefferliste (Felder: `chunk_id`, `score`, `title`, `text`, `doc_type`, `doc_id_with_rev`, `product_families`, `revision`, `language`, `page`).
5. Filtere Treffer ohne `web_url` heraus (Defekt im Index — als Warnung melden).

# OUTPUT (an den Aufrufer)
1. Markdown-Tabelle mit Spalten: `rank | doc_id_with_rev | page | score | snippet | web_url`.
2. Kompakte 2–3-Satz-Antwort in der Sprache der ursprünglichen Anfrage. Snippets bleiben in der Originalsprache des PDFs.
3. Bei leerem Treffersatz: `⚠️ LOW_CONFIDENCE: keine Treffer über Threshold` + Vorschlag, Query zu verfeinern oder `--product`/`--doc-type` zu lockern.

# REGELN
- Nur jüngste Revision pro DocID (vom Index garantiert — nicht verfälschen).
- `doc_id_with_rev` zitieren (z. B. `30491852C`), nicht nur `doc_id`.
- `web_url` ist Pflichtfeld in jedem Treffer.
- Snippets nicht übersetzen, nicht paraphrasieren — wörtlich aus dem Skript-Output.
- Produktfilter ausschließlich aus `config/product_families.json` (kanonische Liste).

# HANDOFF
```
## Handoff
**Next agent needs:** Top-K-Treffer mit SharePoint-URLs; ggf. Folge-Query mit verfeinertem Produkt-/Doc-Type-Filter
<!-- trace: <trace_id> -->
```
