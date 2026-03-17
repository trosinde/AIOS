# AIOS – AI Orchestration System

CLI-basiertes AI-Orchestrierungssystem. Fabric-Style Patterns + Enterprise Integration Patterns. Natürlichsprachliche Aufgaben werden dynamisch in parallele Workflows zerlegt.

## Quickstart

```bash
npm install
export ANTHROPIC_API_KEY=your-key

# Fabric-Style: Ein Pattern direkt
echo "Langer Text..." | npx tsx src/cli.ts run summarize

# Dynamisch: Router plant den Workflow
npx tsx src/cli.ts "Review diesen Code auf Security und Qualität"

# Nur Plan anzeigen
npx tsx src/cli.ts plan "Implementiere OAuth2 mit IEC 62443 Compliance"
```

## Architektur

```
User Input → [Router/Meta-Agent] → Execution Plan (JSON) → [DAG Engine] → Output
```

Drei Schichten:

1. **Pattern Registry** – Markdown-Dateien (`patterns/*/system.md`) mit YAML-Frontmatter. Neue Patterns = neue Datei.
2. **Router** – LLM-Call der Aufgabe + Katalog analysiert → JSON Plan (pipe, scatter-gather, DAG, saga)
3. **Engine** – Mechanische Ausführung: `Promise.all` für Paralleles, Retry/Rollback bei Fehler

## Pattern-Typen

### LLM-Patterns (Standard)

Text rein → LLM verarbeitet → Text raus.

```bash
echo "Code..." | npx tsx src/cli.ts run code_review
```

### Tool-Patterns

Text rein → CLI-Tool ausführen → Datei raus. Kein LLM-Aufruf.

```yaml
# In system.md Frontmatter:
type: tool
tool: mmdc
tool_args: ["-i", "$INPUT", "-o", "$OUTPUT"]
```

## CLI Befehle

```bash
# Dynamische Orchestrierung
npx tsx src/cli.ts "Natürlichsprachliche Aufgabe"

# Ein Pattern direkt (Fabric-Style)
echo "text" | npx tsx src/cli.ts run <pattern>

# Pattern mit Parametern
echo "text" | npx tsx src/cli.ts run <pattern> --key=value

# Nur planen, nicht ausführen
npx tsx src/cli.ts plan "Aufgabe"

# Patterns auflisten (gruppiert nach Kategorie)
npx tsx src/cli.ts patterns list
npx tsx src/cli.ts patterns list --category=review

# Patterns durchsuchen
npx tsx src/cli.ts patterns search "security"

# Pattern-Details anzeigen
npx tsx src/cli.ts patterns show code_review

# Neues Pattern erstellen (Template)
npx tsx src/cli.ts patterns create my_pattern --category=analyze
```

## Bilder erzeugen

AIOS kann Bilder generieren – über einen LLM-optimierten Prompt + Bildgenerierungs-API.

### Setup

```bash
# 1. Wrapper-Script installieren
chmod +x tools/render-image.sh
sudo ln -s $(pwd)/tools/render-image.sh /usr/local/bin/render-image

# 2. API-Key für gewünschtes Backend setzen

# Option A: OpenAI DALL-E 3 (Standard)
export OPENAI_API_KEY=your-key

# Option B: Stability AI
export STABILITY_API_KEY=your-key
export IMAGE_BACKEND=stability

# Option C: Replicate (Flux)
export REPLICATE_API_TOKEN=your-token
export IMAGE_BACKEND=replicate
```

### Verwendung

```bash
# Direkt: Prompt → Bild
echo "nano banana" | npx tsx src/cli.ts run generate_image_prompt | npx tsx src/cli.ts run render_image

# Schritt für Schritt:

# 1. LLM optimiert den Prompt
echo "nano banana" | npx tsx src/cli.ts run generate_image_prompt
# → "a tiny nanoscale banana, microscopic view, scanning electron microscope
#    aesthetic, highly detailed surface texture, scientific visualization style,
#    dramatic side lighting, deep depth of field, 8k, photorealistic rendering,
#    dark background with subtle blue tones"

# 2. Optimierter Prompt → Bild
echo "a tiny nanoscale banana, microscopic view, ..." | npx tsx src/cli.ts run render_image
# → output/run-1234567890.png

# Oder als Workflow (Router plant automatisch):
npx tsx src/cli.ts "Erstelle ein Bild von einer nano banana"
```

### Unterstützte Backends

| Backend | Env-Var | Modell | `IMAGE_BACKEND` |
|---------|---------|--------|-----------------|
| OpenAI | `OPENAI_API_KEY` | DALL-E 3 | `openai` (Standard) |
| Stability AI | `STABILITY_API_KEY` | Stable Diffusion | `stability` |
| Replicate | `REPLICATE_API_TOKEN` | Flux Schnell | `replicate` |

### Bildgröße anpassen

```bash
export IMAGE_SIZE=1792x1024   # Für OpenAI DALL-E (1024x1024, 1024x1792, 1792x1024)
```

## Diagramme erzeugen

```bash
# Mermaid installieren
npm install -g @mermaid-js/mermaid-cli

# Text → Mermaid-Code → SVG
echo "OAuth2 Authorization Code Flow mit Client, Auth Server und Resource Server" \
  | npx tsx src/cli.ts run generate_diagram \
  | npx tsx src/cli.ts run render_diagram

# Oder direkt Mermaid rendern
echo "graph TD; A-->B; B-->C" | npx tsx src/cli.ts run render_diagram
```

## Patterns

28 Patterns in 7 Kategorien:

| Kategorie | Patterns |
|-----------|---------|
| **analyze** | `extract_requirements`, `gap_analysis`, `identify_risks`, `threat_model` |
| **generate** | `generate_code`, `generate_tests`, `generate_docs`, `generate_adr`, `generate_diagram`, `generate_image_prompt` |
| **review** | `code_review`, `security_review`, `architecture_review`, `requirements_review`, `test_review` |
| **transform** | `summarize`, `refactor`, `translate_technical`, `simplify_text`, `formalize` |
| **report** | `aggregate_reviews`, `compliance_report`, `test_report`, `risk_report` |
| **tool** | `render_diagram` (mmdc), `render_image` (DALL-E/Stability/Replicate) |
| **meta** | `_router`, `evaluate_quality`, `extract_knowledge` (intern) |

Jedes Pattern hat zwei Rollen in einer Datei:

```markdown
---
name: code_review              ← Metadaten (für den Router)
description: "..."
parallelizable_with: [security_review]
---
# IDENTITY and PURPOSE         ← Prompt (für die Ausführung)
Du bist ein Senior Reviewer...
```

### Eigene Patterns erstellen

```bash
npx tsx src/cli.ts patterns create my_pattern --category=analyze
# → patterns/my_pattern/system.md (Template zum Bearbeiten)
```

## Konfiguration

AIOS sucht Config in dieser Reihenfolge:

1. `./aios.yaml` (Projekt-lokal)
2. `~/.aios/config.yaml` (Global)
3. Defaults

```yaml
# aios.yaml
providers:
  claude:
    type: anthropic
    model: claude-sonnet-4-20250514
  ollama:
    type: ollama
    model: llama3.2
    endpoint: http://localhost:11434

defaults:
  provider: claude

paths:
  patterns: ./patterns

tools:
  output_dir: ./output
  allowed: [mmdc, render-image, prettier, eslint]
```

### Tool-Sicherheit

Tool-Patterns führen CLI-Befehle aus. Aus Sicherheitsgründen:
- Nur Tools in `tools.allowed` dürfen ausgeführt werden
- Nicht installierte Tools werden erkannt und gemeldet
- Output-Verzeichnis ist konfigurierbar

## Docs

- `CLAUDE.md` – Instruktionen für Claude Code
- `docs/` – Konzeptdokumentation (Architektur, Workflows, Patterns)
