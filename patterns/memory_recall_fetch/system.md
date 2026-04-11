---
kernel_abi: 1
name: memory_recall_fetch
version: "1.0"
description: "Führt die search_queries aus memory_recall gegen MemPalace aus und liefert einen gefüllten Kontext-Block als Markdown"
category: knowledge
type: tool
tool: tsx
tool_args: ["tools/mempalace-recall.ts", "$INPUT", "$OUTPUT"]
input_type: structured
input_format: in
output_type: text
output_format: [md]
tags: [knowledge, memory, recall, context, mempalace]
can_follow: [memory_recall]
can_precede: [extract_requirements, design_solution, generate_code, code_review, security_review, threat_model, compliance_report, architecture_review]
---

# memory_recall_fetch

Read-Path-Gegenstück zu `memory_store_persist`. Nimmt den JSON-Output des
`memory_recall` Patterns entgegen, führt die geplanten
`mempalace_search` Queries über MCP aus, gruppiert die Treffer in vier
Sektionen (Entscheidungen / Fakten / Findings / Patterns & Lessons) und
schreibt einen fertigen Markdown-Kontext-Block nach `$OUTPUT`.

Weil das Pattern `output_type: text` deklariert, inlined die Engine
(`src/core/engine.ts`, `executeTool`) den Datei-Inhalt als Message-Content.
Nachfolgende LLM-Steps sehen den Kontext-Block direkt in ihrem
`input_from`-Payload und können ihn für bessere, kontextgestützte
Entscheidungen nutzen.

## Input

Der rohe (ContextBuilder-markdown-umwrappte) Output des `memory_recall`
Patterns. Das Tool-Script extrahiert das erste balancierte JSON-Objekt
und liest daraus `search_queries[]`.

## Output

Markdown mit vier Abschnitten:

```markdown
# Relevanter Kontext aus MemPalace

> N Treffer aus M Suchanfrage(n).

## Bekannte Entscheidungen
- …

## Constraints & Fakten
- …

## Bekannte Risiken & Findings
- …

## Patterns & Lessons Learned
- …

---

_Suchanfragen:_
- `kernel abi` [wing_aios_decisions]
- …
```

## Fire-and-forget

Das Script exitet IMMER mit 0. Bei fehlender MemPalace, malformed Input
oder MCP-Fehlern wird stattdessen ein Markdown-Block mit
`_Kein Kontext verfügbar: …_` geschrieben. Der umgebende AIOS-Workflow
läuft ungestört weiter – nachfolgende Steps bekommen einfach keinen
nützlichen Kontext, werden aber nicht gebrochen.

## Limits

- Maximal 4 Queries werden ausgeführt (MAX_QUERIES)
- Maximal 5 Treffer pro Query (MAX_HITS_PER_QUERY)
- Maximal 20 Treffer insgesamt (MAX_TOTAL_HITS)
- Deduplikation nach `content` (case-insensitive trim)
