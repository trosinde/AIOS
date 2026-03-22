---
kernel_abi: 1
name: pdf_merge
version: "1.0"
description: "Führt mehrere PDF-Dateien zu einem Dokument zusammen"
category: pdf
type: tool
tool: tsx
tool_args: ["tools/pdf-tools.ts", "merge", "$INPUT", "$OUTPUT"]
input_type: file_list
input_format: txt
output_type: file
output_format: [pdf]
tags: [pdf, merge, combine, document]
---

# PDF Merge

Führt mehrere PDF-Dateien zu einem einzigen PDF zusammen.

## Input

Eine Datei pro Zeile mit dem Pfad zur jeweiligen PDF:

```
/pfad/zur/datei1.pdf
/pfad/zur/datei2.pdf
/pfad/zur/datei3.pdf
```

## Aufruf

```bash
echo -e "/pfad/a.pdf\n/pfad/b.pdf" | aios run pdf_merge
```

## Output

Eine zusammengeführte PDF-Datei mit allen Seiten in der angegebenen Reihenfolge.
