---
kernel_abi: 1
name: memory_store_persist
version: "1.0"
description: "Schreibt memory_items aus memory_store persistent in MemPalace (MCP, fire-and-forget)"
category: knowledge
type: tool
tool: tsx
tool_args: ["tools/mempalace-persist.ts", "$INPUT", "$OUTPUT"]
input_type: structured
input_format: txt
output_type: text
output_format: [txt]
tags: [knowledge, memory, persistence, mempalace]
can_follow: [memory_store]
---

# memory_store_persist

Dieser Step ist der Schreib-Teil der MemPalace-Integration. Er nimmt den JSON-Output
des `memory_store` Patterns (mit `memory_items[]`) entgegen, spawnt MemPalace kurz
über MCP und ruft für jedes Item `mempalace_check_duplicate` + `mempalace_add_drawer`.

## Input

Der rohe (markdown-umwrappte) Output des `memory_store` Patterns. Der Tool-Script
extrahiert das erste balancierte JSON-Objekt und verarbeitet dessen `memory_items`.

## Output

Eine kurze Markdown-Summary (`stored / duplicates / failed / total`). Bei Ausfall
von MemPalace oder Input-Parsing-Fehlern wird ein `skipped`-Status gemeldet,
der Step exitet aber **immer mit 0** – der umgebende Workflow wird nicht gebrochen
(fire-and-forget nach CLAUDE.md).

## Aufruf

Automatisch durch den Router geplant, wenn `memory_store` im Plan vorkommt und
MemPalace konfiguriert ist. Manuell:

```bash
echo '{"memory_items":[{"wing":"wing_aios_decisions","room":"mcp","type":"decision","content":"…"}]}' \
  | aios run memory_store_persist
```
