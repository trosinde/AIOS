---
kernel_abi: 1
name: pdf_split
version: "2.0"
description: "Teilt eine PDF in einzelne Seiten oder Seitenbereiche auf"
category: pdf
type: internal
internal_op: pdf_split
input_type: file_path
input_format: txt
output_type: file
output_format: [pdf]
tags: [pdf, split, pages, document]
can_precede: [pdf_merge, pdf_extract_text]
---

# PDF Split

Teilt eine PDF-Datei in einzelne Seiten oder Seitenbereiche.

## Input

Zeile 1: Pfad zur PDF-Datei
Zeile 2 (optional): Seitenangabe (z.B. `1-3,5,7-9`)

```
/pfad/zur/datei.pdf
1-3,5,7-9
```

Ohne Seitenangabe wird jede Seite als einzelne PDF extrahiert.

## Aufruf

```bash
echo -e "/pfad/datei.pdf\n1-5" | aios run pdf_split
```

## Output

Bei Seitenangabe: Eine PDF mit den angegebenen Seiten.
Ohne Seitenangabe: Einzelne PDFs pro Seite (page-001.pdf, page-002.pdf, ...).
