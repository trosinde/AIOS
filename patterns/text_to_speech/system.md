---
kernel_abi: 1
name: text_to_speech
version: "1.0"
description: "Konvertiert Text zu natürlicher Sprache (Audio-Datei)"
category: audio
type: tts
input_type: text
output_type: file
output_format: [mp3, wav, opus, aac]
tts_voice: alloy
tts_model: tts-1
tts_format: mp3
tts_speed: 1.0
tags: [audio, tts, speech, voice, sprache]
parameters:
  - name: voice
    type: enum
    description: "Stimme für die Sprachsynthese"
    values: [alloy, echo, fable, onyx, nova, shimmer]
    default: alloy
  - name: format
    type: enum
    description: "Audio-Ausgabeformat"
    values: [mp3, wav, opus, aac]
    default: mp3
  - name: speed
    type: number
    description: "Sprechgeschwindigkeit (0.25 - 4.0)"
    default: 1.0
  - name: model
    type: enum
    description: "TTS-Modell (tts-1 = schnell, tts-1-hd = hochwertig)"
    values: [tts-1, tts-1-hd]
    default: tts-1
can_follow: [summarize, extract_wisdom, generate_blog_post, translate]
---

# Text-to-Speech

Konvertiert eingehenden Text in eine natürlich klingende Audio-Datei via OpenAI TTS API.

## Unterstützte Stimmen

| Voice   | Charakter           |
|---------|---------------------|
| alloy   | Neutral, vielseitig |
| echo    | Warm, männlich      |
| fable   | Expressiv, britisch |
| onyx    | Tief, autoritär     |
| nova    | Freundlich, weiblich|
| shimmer | Klar, optimistisch  |

## Modelle

- **tts-1**: Schnell, geringere Latenz, Standard
- **tts-1-hd**: Höhere Audio-Qualität, etwas langsamer
