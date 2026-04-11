---
kernel_abi: 1
name: render_diagram
version: "1.1"
description: Rendert Mermaid-Code zu SVG/PNG Datei via mermaid-cli (mmdc)
category: tool
type: tool
driver: mermaid
operation: render
input_type: mermaid_code
input_format: mmd
output_type: file
output_format: [svg, png, pdf]
tags: [render, diagram, mermaid, visualization]
can_follow: [generate_diagram]
---

# TOOL CONFIGURATION

Dieses Pattern ist ein Tool-Pattern. Es ruft kein LLM auf, sondern führt das
CLI-Tool `mmdc` (mermaid-cli) aus.

## Voraussetzung

```bash
npm install -g @mermaid-js/mermaid-cli
```

## Aufruf

Der Input (Mermaid-Code) wird in eine .mmd Datei geschrieben, dann wird mmdc aufgerufen:

```bash
mmdc -i input.mmd -o output.svg -t dark -b transparent
```

## Output

Dateipfad der erzeugten Grafik.
