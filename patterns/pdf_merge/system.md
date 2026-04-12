---
kernel_abi: 1
name: pdf_merge
version: "2.0"
description: "Führt mehrere PDF-Dateien zu einem Dokument zusammen"
category: pdf
type: internal
internal_op: pdf_merge
input_type: file_list
input_format: txt
output_type: file
output_format: [pdf]
tags: [pdf, merge, combine, document]
can_follow: [pdf_split]
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
