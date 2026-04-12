---
kernel_abi: 1
name: pdf_extract_text
version: "2.0"
description: "Extrahiert Text aus einer PDF-Datei"
category: pdf
type: internal
internal_op: pdf_extract_text
input_type: file_path
input_format: txt
output_type: text
output_format: [txt]
tags: [pdf, text, extract, ocr, document]
can_precede: [summarize, extract_wisdom, analyze_paper]
---

# PDF Text Extract

Extrahiert den gesamten Text aus einer PDF-Datei.

## Input

Der Pfad zur PDF-Datei:

```
/pfad/zur/datei.pdf
```

## Aufruf

```bash
echo "/pfad/datei.pdf" | aios run pdf_extract_text
```

## Output

Der extrahierte Text als Plaintext-Datei. Kann direkt an LLM-Patterns wie `summarize` oder `extract_wisdom` weitergeleitet werden.
