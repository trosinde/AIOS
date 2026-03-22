---
kernel_abi: 1
name: pdf_convert
version: "1.0"
description: "Konvertiert Bilder (PNG/JPG) zu PDF"
category: pdf
type: tool
tool: tsx
tool_args: ["tools/pdf-tools.ts", "img-to-pdf", "$INPUT", "$OUTPUT"]
input_type: file_list
input_format: txt
output_type: file
output_format: [pdf]
tags: [pdf, convert, image, png, jpg, document]
---

# PDF Convert (Image → PDF)

Konvertiert Bilder zu einer PDF-Datei. Jedes Bild wird als eigene Seite eingefügt.

## Input

Eine Datei pro Zeile mit dem Pfad zum jeweiligen Bild:

```
/pfad/zum/bild1.png
/pfad/zum/bild2.jpg
```

Unterstützte Formate: PNG, JPG/JPEG.

## Aufruf

```bash
echo -e "/pfad/bild1.png\n/pfad/bild2.jpg" | aios run pdf_convert
```

## Output

Eine PDF-Datei mit den Bildern als Seiten (Originalgröße).
