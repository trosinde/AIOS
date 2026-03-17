# AIOS User Guide

## Installation

### Voraussetzungen

- **Node.js 20+** ([nodejs.org](https://nodejs.org))
- **API-Key** für mindestens einen LLM-Provider (Claude oder Ollama)

### Setup

```bash
# 1. Repository klonen
git clone https://github.com/trosinde/AIOS.git
cd AIOS

# 2. Dependencies installieren
npm install

# 3. API-Key setzen
export ANTHROPIC_API_KEY=your-key-here
```

### Verifizieren

```bash
npx tsx src/cli.ts patterns list
```

Wenn eine Liste von Patterns erscheint, ist alles korrekt eingerichtet.

---

## First Steps

### Erstes Ergebnis in 30 Sekunden

```bash
echo "TypeScript ist eine typisierte Obermenge von JavaScript" | npx tsx src/cli.ts run summarize
```

AIOS nimmt den Text, schickt ihn mit dem `summarize`-Prompt an das LLM und gibt die Zusammenfassung aus.

### Wie AIOS funktioniert

```
echo "text" | aios run <pattern>
```

1. Du gibst Text über stdin ein
2. AIOS lädt das Pattern (Prompt-Template aus `patterns/*/system.md`)
3. Das LLM verarbeitet den Text mit diesem Prompt
4. Das Ergebnis kommt auf stdout

Das ist das **Fabric-Prinzip**: Wiederverwendbare Prompts als Unix-Pipes.

### Dynamische Orchestrierung

```bash
npx tsx src/cli.ts "Analysiere diese Architektur und erstelle ein Threat Model"
```

Hier plant AIOS automatisch den Workflow:

1. Der **Router** (ein LLM-Call) analysiert die Aufgabe
2. Er wählt passende Patterns und erstellt einen Plan
3. Die **Engine** führt den Plan aus – parallel wo möglich

---

## Alle Befehle

### `aios "Aufgabe"` – Dynamische Orchestrierung

```bash
npx tsx src/cli.ts "Review diesen Code auf Security und Qualität"
```

Der Router plant automatisch, welche Patterns in welcher Reihenfolge ausgeführt werden.

**Optionen:**

| Option | Beschreibung |
|--------|-------------|
| `--dry-run` | Nur Plan anzeigen, nicht ausführen |
| `--provider <name>` | Anderen LLM-Provider nutzen |

```bash
# Nur Plan anzeigen (JSON)
npx tsx src/cli.ts --dry-run "Erstelle ein Design für eine REST API"

# Mit Ollama statt Claude
npx tsx src/cli.ts --provider ollama "Fasse diesen Text zusammen"
```

### `aios run <pattern>` – Pattern direkt ausführen

```bash
echo "Code hier..." | npx tsx src/cli.ts run code_review
```

Führt genau ein Pattern aus. Input kommt via stdin, Output geht auf stdout.

**Mit Parametern:**

```bash
echo "Spec..." | npx tsx src/cli.ts run gap_analysis --reference=iec62443
```

Parameter werden als `--key=value` übergeben und dem Prompt hinzugefügt.

**Pipes (Unix-Style):**

```bash
cat design.md | npx tsx src/cli.ts run extract_requirements | npx tsx src/cli.ts run generate_tests
```

Mehrere Patterns hintereinander schalten – der Output des einen ist der Input des nächsten.

### `aios plan "Aufgabe"` – Nur planen

```bash
npx tsx src/cli.ts plan "Implementiere OAuth2 mit Compliance-Check"
```

Gibt den Execution Plan als JSON aus, ohne ihn auszuführen. Nützlich zum Debuggen oder um zu verstehen, was AIOS tun würde.

### `aios patterns list` – Patterns auflisten

```bash
# Alle Patterns (gruppiert nach Kategorie)
npx tsx src/cli.ts patterns list

# Nur eine Kategorie
npx tsx src/cli.ts patterns list --category=review
```

### `aios patterns search` – Patterns suchen

```bash
npx tsx src/cli.ts patterns search "security"
npx tsx src/cli.ts patterns search "diagram visualization"
```

Durchsucht Name, Beschreibung und Tags aller Patterns.

### `aios patterns show` – Pattern-Details

```bash
npx tsx src/cli.ts patterns show code_review
```

Zeigt Metadaten, Parameter, Abhängigkeiten und den vollständigen Prompt.

### `aios patterns create` – Neues Pattern erstellen

```bash
npx tsx src/cli.ts patterns create my_analysis --category=analyze --description="Meine Analyse"
```

Erstellt ein Template unter `patterns/my_analysis/system.md` das du bearbeiten kannst.

---

## Pattern-Katalog

### Analyze – Texte analysieren und strukturieren

| Pattern | Beschreibung | Beispiel |
|---------|-------------|---------|
| `extract_requirements` | Requirements aus Text extrahieren | `cat spec.md \| aios run extract_requirements` |
| `gap_analysis` | Lücken zwischen Ist und Soll finden | `cat doc.md \| aios run gap_analysis --reference=iec62443` |
| `identify_risks` | Risiken identifizieren und bewerten | `cat design.md \| aios run identify_risks` |
| `threat_model` | STRIDE Threat Model erstellen | `cat architecture.md \| aios run threat_model` |

### Generate – Artefakte erzeugen

| Pattern | Beschreibung | Beispiel |
|---------|-------------|---------|
| `generate_code` | Code aus Design-Spec generieren | `cat design.md \| aios run generate_code` |
| `generate_tests` | Testfälle aus Requirements/Code | `cat code.ts \| aios run generate_tests` |
| `generate_docs` | Technische Dokumentation | `cat code.ts \| aios run generate_docs` |
| `generate_adr` | Architecture Decision Record | `echo "Warum Redis statt Memcached?" \| aios run generate_adr` |
| `generate_diagram` | Mermaid-Diagramm-Code | `cat design.md \| aios run generate_diagram` |
| `generate_image_prompt` | Optimierter Bild-Prompt | `echo "nano banana" \| aios run generate_image_prompt` |
| `write_architecture_doc` | Architektur-Dokumentation | `cat src/*.ts \| aios run write_architecture_doc` |
| `write_user_doc` | User-Dokumentation | `cat src/cli.ts \| aios run write_user_doc` |

### Review – Code und Dokumente prüfen

| Pattern | Beschreibung | Beispiel |
|---------|-------------|---------|
| `code_review` | Systematisches Code Review | `cat app.ts \| aios run code_review` |
| `security_review` | Security-Review (OWASP, IEC 62443) | `cat api.ts \| aios run security_review` |
| `architecture_review` | Architektur bewerten | `cat design.md \| aios run architecture_review` |
| `requirements_review` | Requirements-Qualität prüfen | `cat requirements.md \| aios run requirements_review` |
| `test_review` | Testabdeckung und -qualität | `cat tests.ts \| aios run test_review` |

### Transform – Texte umwandeln

| Pattern | Beschreibung | Beispiel |
|---------|-------------|---------|
| `summarize` | Zusammenfassung erstellen | `cat report.md \| aios run summarize` |
| `refactor` | Code refactoren | `cat legacy.ts \| aios run refactor --goal=readability` |
| `translate_technical` | Technische Übersetzung | `cat doc_de.md \| aios run translate_technical --target_language=en` |
| `simplify_text` | Vereinfachen für breitere Zielgruppe | `cat spec.md \| aios run simplify_text --audience=management` |
| `formalize` | Notizen → formelles Dokument | `cat notes.txt \| aios run formalize --format=protocol` |

### Report – Berichte erstellen

| Pattern | Beschreibung | Beispiel |
|---------|-------------|---------|
| `aggregate_reviews` | Mehrere Reviews konsolidieren | (automatisch in Workflows) |
| `compliance_report` | Compliance-Bericht (IEC 62443) | `cat artefakte.md \| aios run compliance_report` |
| `test_report` | Formaler Test-Report | `cat results.json \| aios run test_report` |
| `risk_report` | Management-Risiko-Report | `cat risks.md \| aios run risk_report` |

### Tool – CLI-Tools ausführen (kein LLM)

| Pattern | Tool | Beschreibung | Beispiel |
|---------|------|-------------|---------|
| `render_diagram` | `mmdc` | Mermaid → SVG/PNG | `echo "graph TD; A-->B" \| aios run render_diagram` |
| `render_image` | `render-image` | Prompt → Bild (PNG) | `echo "a sunset over mountains" \| aios run render_image` |

---

## Praxis-Rezepte

### Code auf Security und Qualität prüfen

```bash
npx tsx src/cli.ts "Review diesen Code auf Security und Qualität" < src/core/engine.ts
```

AIOS führt `code_review` und `security_review` parallel aus und konsolidiert die Ergebnisse.

### Architektur-Diagramm erzeugen

```bash
# Mermaid-CLI installieren (einmalig)
npm install -g @mermaid-js/mermaid-cli

# Text → Mermaid → SVG
echo "OAuth2 Flow mit Client, Auth Server, Resource Server" \
  | npx tsx src/cli.ts run generate_diagram \
  | npx tsx src/cli.ts run render_diagram
```

### Bild generieren

```bash
# Setup (einmalig)
chmod +x tools/render-image.sh
sudo ln -s $(pwd)/tools/render-image.sh /usr/local/bin/render-image
export OPENAI_API_KEY=your-key

# Bild erzeugen
echo "nano banana" \
  | npx tsx src/cli.ts run generate_image_prompt \
  | npx tsx src/cli.ts run render_image
```

Unterstützte Backends: OpenAI DALL-E 3 (Standard), Stability AI, Replicate (Flux).
Siehe `tools/render-image.sh` für Details.

### Von Requirements zu Tests

```bash
cat feature_request.txt \
  | npx tsx src/cli.ts run extract_requirements \
  | npx tsx src/cli.ts run generate_tests
```

### Meeting-Notizen formalisieren

```bash
cat meeting_notes.txt | npx tsx src/cli.ts run formalize --format=protocol
```

### Technische Übersetzung

```bash
cat README_de.md | npx tsx src/cli.ts run translate_technical --target_language=en
```

---

## Konfiguration

### Konfigurationsdatei

AIOS sucht die Config in dieser Reihenfolge:

1. `./aios.yaml` im aktuellen Verzeichnis
2. `~/.aios/config.yaml` global
3. Eingebaute Defaults

### Beispiel `aios.yaml`

```yaml
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
  allowed:
    - mmdc
    - render-image
    - prettier
```

### Provider wechseln

```bash
# Per CLI-Option
npx tsx src/cli.ts --provider ollama "Fasse zusammen"

# Oder in aios.yaml
defaults:
  provider: ollama
```

### Ollama (lokal, kostenlos)

```bash
# Ollama installieren: https://ollama.ai
ollama pull llama3.2

# In aios.yaml konfigurieren
providers:
  ollama:
    type: ollama
    model: llama3.2
    endpoint: http://localhost:11434
```

### Tool-Sicherheit

Tool-Patterns führen CLI-Befehle aus. Nur Tools in der Allowlist werden ausgeführt:

```yaml
tools:
  allowed: [mmdc, render-image]   # Nur diese Tools erlaubt
  output_dir: ./output            # Wohin Dateien geschrieben werden
```

---

## Eigene Patterns erstellen

### Per CLI

```bash
npx tsx src/cli.ts patterns create my_analysis --category=analyze
```

Erstellt `patterns/my_analysis/system.md` mit einem Template.

### Manuell

Erstelle `patterns/<name>/system.md`:

```markdown
---
name: my_analysis
version: "1.0"
description: "Beschreibung was das Pattern tut"
category: analyze
input_type: text
output_type: findings
tags: [analysis, custom]
---

# IDENTITY and PURPOSE

Du bist ein Experte für [Bereich].

# STEPS

1. Analysiere den Input
2. [Weitere Schritte]

# OUTPUT FORMAT

[Beschreibung des gewünschten Formats]

# INPUT
```

### Eigenes Tool-Pattern

```markdown
---
name: my_tool
type: tool
tool: my-cli-tool
tool_args: ["-i", "$INPUT", "-o", "$OUTPUT"]
input_format: txt
output_format: [pdf]
---
```

Vergiss nicht, das Tool zur Allowlist in `aios.yaml` hinzuzufügen.

---

## Troubleshooting

### `Provider "X" nicht gefunden`

Der in `--provider` angegebene oder in `defaults.provider` konfigurierte Provider existiert nicht in der Config.

```bash
# Prüfe verfügbare Provider
grep -A2 "providers:" aios.yaml
```

### `Pattern "X" nicht gefunden`

```bash
# Alle verfügbaren Patterns anzeigen
npx tsx src/cli.ts patterns list

# Pattern suchen
npx tsx src/cli.ts patterns search "keyword"
```

### `Kein Input`

Patterns erwarten Input via stdin:

```bash
# Falsch:
npx tsx src/cli.ts run summarize

# Richtig:
echo "Text..." | npx tsx src/cli.ts run summarize
cat datei.md | npx tsx src/cli.ts run summarize
```

### `Tool "X" ist nicht installiert`

Tool-Patterns brauchen das CLI-Tool auf dem System:

```bash
# Mermaid
npm install -g @mermaid-js/mermaid-cli

# Bildgenerierung
chmod +x tools/render-image.sh
sudo ln -s $(pwd)/tools/render-image.sh /usr/local/bin/render-image
```

### `Tool "X" ist nicht in der Allowlist`

Füge das Tool in `aios.yaml` hinzu:

```yaml
tools:
  allowed: [mmdc, render-image, mein-tool]
```

### Ollama antwortet nicht

```bash
# Prüfe ob Ollama läuft
curl http://localhost:11434/api/tags

# Modell herunterladen falls nötig
ollama pull llama3.2
```

### `ANTHROPIC_API_KEY` nicht gesetzt

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Für permanente Einrichtung in `~/.bashrc` oder `~/.zshrc` eintragen.
