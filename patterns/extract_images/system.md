---
kernel_abi: 1
name: extract_images
version: "1.0"
description: "Extrahiert eingebettete Bilder aus PDF, PPTX und DOCX Dokumenten"
category: tool
type: tool
tool: tsx
tool_args: ["tools/extract-images.ts", "$INPUT", "$OUTPUT"]
input_type: file
input_format: txt
output_type: file
output_format: [png, jpg, jpeg]
tags: [image, extract, pdf, pptx, docx, document, reverse-engineering]
can_precede: [image_to_prompt, pdf_vision_ocr]
---

# TOOL CONFIGURATION

Dieses Pattern extrahiert eingebettete Bilder aus Dokumenten.

## Unterstützte Formate

- **PDF** (.pdf) — Extrahiert eingebettete Rasterbilder via pdfjs-dist
- **PowerPoint** (.pptx) — Extrahiert Bilder aus `ppt/media/`
- **Word** (.docx) — Extrahiert Bilder aus `word/media/`

## Aufruf

```bash
echo "/pfad/zum/dokument.pptx" | aios run extract_images
```

## Input

Der Input ist der Dateipfad zum Quelldokument (eine Zeile).

## Output

JSON auf stdout mit den Pfaden der extrahierten Bilder:

```json
{"images": ["output/image-001.png", "output/image-002.jpg"]}
```

Die Bilder werden im konfigurierten Output-Verzeichnis abgelegt.
