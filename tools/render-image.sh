#!/usr/bin/env bash
#
# render-image – Wrapper für verschiedene Bildgenerierungs-APIs
#
# Usage: render-image <input-file> <output-file>
#
# Backends (gesteuert über $IMAGE_BACKEND):
#   openai     – DALL-E 3 via OpenAI API (Standard)
#   stability  – Stable Diffusion via Stability AI API
#   replicate  – Flux via Replicate API
#
# Benötigte Env-Vars je Backend:
#   openai:    OPENAI_API_KEY
#   stability: STABILITY_API_KEY
#   replicate: REPLICATE_API_TOKEN
#

set -euo pipefail

INPUT_FILE="${1:?Usage: render-image <input-file> <output-file>}"
OUTPUT_FILE="${2:?Usage: render-image <input-file> <output-file>}"
BACKEND="${IMAGE_BACKEND:-openai}"
IMAGE_SIZE="${IMAGE_SIZE:-1024x1024}"

PROMPT="$(cat "$INPUT_FILE")"

if [ -z "$PROMPT" ]; then
  echo "Error: Input-Datei ist leer" >&2
  exit 1
fi

case "$BACKEND" in
  openai)
    # ─── DALL-E 3 via OpenAI API ────────────────────────
    : "${OPENAI_API_KEY:?OPENAI_API_KEY muss gesetzt sein}"

    RESPONSE=$(curl -s "https://api.openai.com/v1/images/generations" \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -n \
        --arg prompt "$PROMPT" \
        --arg size "$IMAGE_SIZE" \
        '{model: "dall-e-3", prompt: $prompt, n: 1, size: $size, response_format: "b64_json"}'
      )")

    # Fehler prüfen
    ERROR=$(echo "$RESPONSE" | jq -r '.error.message // empty')
    if [ -n "$ERROR" ]; then
      echo "OpenAI API Error: $ERROR" >&2
      exit 1
    fi

    # Base64-Bild extrahieren und speichern
    echo "$RESPONSE" | jq -r '.data[0].b64_json' | base64 -d > "$OUTPUT_FILE"
    ;;

  stability)
    # ─── Stability AI API ───────────────────────────────
    : "${STABILITY_API_KEY:?STABILITY_API_KEY muss gesetzt sein}"

    curl -s "https://api.stability.ai/v2beta/stable-image/generate/core" \
      -H "Authorization: Bearer $STABILITY_API_KEY" \
      -H "Accept: image/*" \
      -F "prompt=$PROMPT" \
      -F "output_format=png" \
      -o "$OUTPUT_FILE"

    # Prüfen ob Output eine Bilddatei ist (nicht JSON-Error)
    if file "$OUTPUT_FILE" | grep -q "JSON\|text"; then
      echo "Stability API Error: $(cat "$OUTPUT_FILE")" >&2
      rm -f "$OUTPUT_FILE"
      exit 1
    fi
    ;;

  replicate)
    # ─── Replicate (Flux) ──────────────────────────────
    : "${REPLICATE_API_TOKEN:?REPLICATE_API_TOKEN muss gesetzt sein}"

    # Prediction starten
    PREDICTION=$(curl -s "https://api.replicate.com/v1/predictions" \
      -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$(jq -n \
        --arg prompt "$PROMPT" \
        '{version: "black-forest-labs/flux-schnell", input: {prompt: $prompt}}'
      )")

    PRED_URL=$(echo "$PREDICTION" | jq -r '.urls.get // empty')
    if [ -z "$PRED_URL" ]; then
      echo "Replicate Error: $(echo "$PREDICTION" | jq -r '.detail // .error // "Unknown error"')" >&2
      exit 1
    fi

    # Auf Ergebnis warten (max 120s)
    for i in $(seq 1 60); do
      STATUS_RESP=$(curl -s "$PRED_URL" \
        -H "Authorization: Bearer $REPLICATE_API_TOKEN")
      STATUS=$(echo "$STATUS_RESP" | jq -r '.status')

      if [ "$STATUS" = "succeeded" ]; then
        IMAGE_URL=$(echo "$STATUS_RESP" | jq -r '.output[0] // .output')
        curl -s "$IMAGE_URL" -o "$OUTPUT_FILE"
        break
      elif [ "$STATUS" = "failed" ]; then
        echo "Replicate Error: $(echo "$STATUS_RESP" | jq -r '.error')" >&2
        exit 1
      fi
      sleep 2
    done

    if [ ! -f "$OUTPUT_FILE" ]; then
      echo "Replicate: Timeout nach 120s" >&2
      exit 1
    fi
    ;;

  *)
    echo "Unbekanntes Backend: $BACKEND (verfügbar: openai, stability, replicate)" >&2
    exit 1
    ;;
esac

echo "Bild erzeugt: $OUTPUT_FILE" >&2
