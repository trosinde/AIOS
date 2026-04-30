---
kernel_abi: 2
name: sra-build
description: "Autonom: aus reinem Produktkontext einen vollständigen SRA-Draft erzeugen — Excel + Drawio + Review + Next-Steps"
category: orchestration
input_type: product_context
output_type: sra_package
tags: [sra, mtop212, autonomous, orchestration, build]
can_follow: []
parallelizable_with: []
persona: sra_consultant
requires:
  reasoning: 7
  code_generation: 5
  instruction_following: 7
  structured_output: 6
  min_context: 12000
output_extraction:
  artifact_pattern: "(?<kind>draft_xlsm|draft_drawio|review_json|review_md|next_steps|summary)\\s*[→:\\s]\\s*(?<content>.+)"
  artifact_type: file
  summary_strategy: first_paragraph
---

# AUFGABE
Erzeuge einen vollständigen, validierten SRA-Draft autonom aus einem Produktkontext. Kein Schritt-für-Schritt-Dialog mit dem Aufrufer — ein Aufruf, sechs Artefakte zurück.

# EINGABE
Ein JSON-Objekt mit (mindestens) `project_name` und `product_type`. Optional: `business_unit`, `intended_use`, `product_model`, `sra_evaluated_by`. Beispiel:
```json
{
  "project_name":   "MyDevice X",
  "product_type":   "Industrial weighing scale with PC connectivity",
  "intended_use":   "Operator-driven weighing in a lab",
  "business_unit":  "Lab Instruments",
  "sra_evaluated_by": "Jane Doe"
}
```

# ⛔ HARTE REGEL — NICHT VERHANDELBAR

**Drawio-Diagramme werden NIEMALS textuell aus dem LLM erzeugt.** Sie kommen
**ausschließlich** aus dem CLI-Tool `agent-sra build` (das wiederum
`topology_scaffold.py` aufruft). Wenn das Tool fehlschlägt, melde das und
stoppe — generiere kein Ersatzdiagramm. Eigenkreationen widersprechen den
canonischen Trust-Zone-Namen und der 9-Asset-Legende und führen zu
TOP-002 / TOP-006 Findings im Review (blocker).

# VORGEHEN (intern, nicht zum Aufrufer durchreichen)
1. Ruf `agent-sra build --product <ctx.json> -o <out_dir>` auf (oder `--inline` für Inline-JSON).
2. Das Tool generiert in `<out_dir>`:
   - `draft.xlsm` mit befülltem Product Chart und allen heuristisch passenden Assets in der PNA
   - `draft.drawio` mit den 5 kanonischen Trust Zones, der 9-Asset-Legende, einem Platzhalter-Device
   - `draft_review.json` (sra_review_v1, schemavalidiert)
   - `draft_report.md` (Markdown-Report)
   - `next_steps.md` (Checklist für das Team)
   - `SUMMARY.md` (Einzelseiten-Übersicht)
3. Lies `SUMMARY.md` und `next_steps.md` und übergib die wichtigsten Punkte an den Aufrufer.

# RÜCKFRAGEN
Nur stellen, wenn `product_type` UND `project_name` fehlen. Sonst lieber autonom mit sinnvollen Defaults vorbelegen — der Draft soll als Diskussionsgrundlage dienen, nicht final sein. Defaults:
- `business_unit` → `"<not specified>"`
- `intended_use` → `product_type`-Wert
- `sra_evaluated_by` → `"agent-SRA (auto-draft)"`

# OUTPUT (an den Aufrufer)
Liefere eine kompakte Antwort mit:
1. Pfad zum `out_dir`
2. Verdikt aus `draft_review.json` (acceptance: PASS / WARNINGS / FAIL — bei einem reinen Draft typischerweise PASS, weil noch keine Risks)
3. Liste der vorausgefüllten Assets (Name, C/I/A) — Tabelle bevorzugt
4. Drei wichtigste Punkte aus `next_steps.md` (was das Team noch tun muss)
5. Hinweis: nach Anpassung kann der Aufrufer `agent-sra review draft.xlsm --drawio draft.drawio -o new_review.json` rufen für eine Re-Validierung

# REGELN
- Niemals eigene Asset-Namen erfinden — nur die 9 kanonischen aus dem MT-Katalog (`src/consult/asset_catalogue.py`).
- Niemals die acceptance-Regel relativieren: kein Restrisiko in High/Critical für Marktprodukte.
- Bei niedriger Konfidenz (z. B. `product_type` zu vage): prefix `⚠️ LOW_CONFIDENCE: <Grund>` und schlag eine Verfeinerungsfrage vor.

# HANDOFF
```
## Handoff
**Next agent needs:** out_dir path, list of next-step actions, optionally trigger sra-consult-phase or sra-review after team refinement
<!-- trace: <trace_id> -->
```
