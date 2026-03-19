---
kernel_abi: 1
name: render_image
version: "1.0"
description: Erzeugt ein Bild aus einem Text-Prompt via Bildgenerierungs-API
category: tool
type: tool
tool: render-image
tool_args: ["$INPUT", "$OUTPUT"]
input_type: image_prompt
input_format: txt
output_type: file
output_format: [png, webp]
tags: [image, render, visualization, creative]
can_follow: [generate_image_prompt]
---

# TOOL CONFIGURATION

Dieses Pattern ist ein Tool-Pattern. Es ruft das `render-image` Wrapper-Script auf,
das verschiedene Bildgenerierungs-Backends unterstützt.

## Voraussetzung

Das Script `tools/render-image.sh` muss im PATH sein oder als `render-image` verfügbar:

```bash
# Einmalig einrichten
chmod +x tools/render-image.sh
sudo ln -s $(pwd)/tools/render-image.sh /usr/local/bin/render-image
```

Zusätzlich muss ein API-Key für das gewählte Backend gesetzt sein:

```bash
# OpenAI DALL-E (Standard)
export OPENAI_API_KEY=your-key

# ODER Stability AI
export STABILITY_API_KEY=your-key
export IMAGE_BACKEND=stability

# ODER Replicate (Flux)
export REPLICATE_API_TOKEN=your-token
export IMAGE_BACKEND=replicate
```

## Aufruf

```bash
render-image input.txt output.png
```

## Output

Dateipfad des erzeugten Bildes (PNG).
