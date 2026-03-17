---
name: render_image
version: "2.0"
description: Erzeugt ein Bild aus einem Text-Prompt via Bildgenerierungs-API
category: generation
type: image
image_provider: openai
image_size: "1024x1024"
input_type: image_prompt
output_type: file
output_format: [png, webp]
tags: [image, render, visualization, creative]
can_follow: [generate_image_prompt]
---

# IMAGE GENERATION

Dieses Pattern nutzt den nativen TypeScript ImageProvider.

## Unterstützte Provider

- **openai** – DALL-E 3 (Standard)
- **stability** – Stable Diffusion via Stability AI
- **replicate** – Flux via Replicate

## Konfiguration

API-Keys werden aus Umgebungsvariablen gelesen:

```bash
# OpenAI DALL-E (Standard)
export OPENAI_API_KEY=your-key

# Stability AI
export STABILITY_API_KEY=your-key

# Replicate (Flux)
export REPLICATE_API_TOKEN=your-token
```

## Input

Der Input ist ein detaillierter Bild-Prompt (idealerweise von `generate_image_prompt`).

## Output

Dateipfad des erzeugten Bildes.
