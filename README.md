# AIOS – AI Orchestration System

Du sagst was du willst. AIOS plant und führt den Workflow automatisch aus –
mit den richtigen AI-Agenten, parallel wo möglich.

```bash
$ npx tsx src/cli.ts "Review diesen Code auf Security und Qualität" < src/core/engine.ts

🧠 Analysiere Aufgabe...
📋 Plan: scatter_gather (3 Schritte)
   review1 → code_review    [∥ reviews]
   review2 → security_review [∥ reviews]
   aggregate → aggregate_reviews

⚡ Starte...
  🔀 Parallel: review1 + review2
  ✅ review1 (3.4s)
  ✅ review2 (4.1s)
  ✅ aggregate (2.8s)

# KONSOLIDIERTES REVIEW
## Code-Qualität
🔴 CRITICAL: Keine Input-Validierung in buildInput()...
## Security
🟠 HIGH: execFile() ohne Shell-Escaping (CWE-78)...
## Top 3 Prioritäten
1. Input-Validierung für step.input_from
2. Shell-Injection-Schutz in executeTool
3. Sichere Temp-Dateien mit randomUUID
```

Was ist passiert? Der **Router** (ein LLM-Call) hat erkannt, dass zwei Reviews
parallel laufen können. Die **Engine** hat sie gleichzeitig ausgeführt und
die Ergebnisse konsolidiert. ~4 Sekunden statt ~10.

---

## Ich will es nutzen

### In Claude Code / Open Code (empfohlen)

AIOS-Patterns direkt in Claude Code oder Open Code nutzen – keine CLI nötig:

```bash
# In deinem Projekt
git clone https://github.com/trosinde/AIOS.git .aios
```

**Slash-Commands** sind sofort verfügbar:

| Command | Pattern | Beschreibung |
|---------|---------|--------------|
| `/review` | code_review | Code Review mit strukturierten Findings |
| `/security` | security_review | Security Review nach OWASP/CWE |
| `/summarize` | summarize | Text zusammenfassen |
| `/tests` | generate_tests | Testfälle generieren |
| `/requirements` | extract_requirements | Requirements extrahieren |
| `/refactor` | refactor | Code refactoren |

**Beispiele:**

```
/review src/api.ts
/security src/auth/
/tests src/utils/parser.ts
/requirements spec.md
```

Oder in natürlicher Sprache:

```
"Review src/api.ts mit dem code_review Pattern"
"Mach ein Security Review von src/auth/"
```

Claude Code liest die Pattern-Dateien aus `.aios/patterns/` und wendet sie an.

### CLI Installation

Für Standalone-Nutzung oder Automatisierung:

```bash
git clone https://github.com/trosinde/AIOS.git && cd AIOS
npm install
export ANTHROPIC_API_KEY=sk-ant-...
```

Verifizieren: `npx tsx src/cli.ts patterns list` sollte 34+ Patterns zeigen (plus dynamisch registrierte MCP-Tools).

Für lokale LLMs (kostenlos): [Ollama einrichten →](#ollama-lokal)

### Ein Pattern ausführen

Das Grundprinzip ist wie [Fabric](https://github.com/danielmiessler/fabric):
Text rein, Prompt-Template drauf, Ergebnis raus.

```bash
# Meeting-Notizen zusammenfassen
$ echo "Am Montag: Release auf Q3 verschoben. Peter → API, Maria → Tests. Budget -15%." \
  | npx tsx src/cli.ts run summarize

ONE SENTENCE SUMMARY:
Release auf Q3 verschoben mit neuer Aufgabenverteilung und Budgetkürzung.

KEY POINTS:
- Release: Q2 → Q3
- Peter: API, Maria: Tests
- Budget: -15%
```

```bash
# Code reviewen
cat app.ts | npx tsx src/cli.ts run code_review

# Security-Check
cat api.ts | npx tsx src/cli.ts run security_review

# Technische Übersetzung
cat README_de.md | npx tsx src/cli.ts run translate_technical --target_language=en
```

### Patterns verketten (Unix-Pipes)

```bash
# Feature-Request → Requirements → Testfälle
cat feature_request.txt \
  | npx tsx src/cli.ts run extract_requirements \
  | npx tsx src/cli.ts run generate_tests
```

Jeder `|` ist ein eigener LLM-Call mit eigenem Prompt-Template.

### Automatische Workflows

Statt manuell Patterns zu verketten, beschreibe einfach was du willst:

```bash
# AIOS plant und führt den besten Workflow automatisch aus
npx tsx src/cli.ts "Analysiere diese Architektur und erstelle ein Threat Model" < design.md

# Nur den Plan sehen (ohne Ausführung)
npx tsx src/cli.ts --dry-run "Implementiere OAuth2 mit Compliance-Check"
```

Der Router entscheidet je nach Aufgabe:

| Du sagst | AIOS macht |
|----------|-----------|
| "Fasse zusammen" | 1 Pattern direkt |
| "Review den Code" | 2-3 Reviews parallel → Konsolidierung |
| "Implementiere Feature X" | Requirements → Design → Code + Tests parallel |
| "Feature mit Compliance" | Wie oben + Quality Gates + Rollback bei Fehler |

### Interaktiver Chat-Modus

Statt einzelner Kommandos: eine interaktive Session mit Konversations-Kontext.
Konversationsverlauf bleibt erhalten – Nachfragen beziehen sich auf vorherige Ergebnisse.

```bash
$ npx tsx src/cli.ts chat

  AIOS Interactive Chat
  34 Patterns geladen. Tippe /help für Befehle.

aios> Welche Patterns gibt es für Code-Analyse?
  ⏳ Denke nach...
  ✅ (130 Tokens)
Es gibt code_review, security_review, architecture_review ...

aios> /code_review --language=python def hello(): print("world")
  ⏳ Führe Pattern code_review aus...
  ✅ Fertig (250 Tokens)
## Code Review ...

aios> Kannst du die Security-Aspekte genauer erklären?
  ⏳ Denke nach...
  ✅ (180 Tokens)
Basierend auf dem Review oben ...
```

**Slash-Commands im Chat:**
- `/<pattern> [text] [--key=value]` – Pattern direkt ausführen
- `/help` – Hilfe anzeigen
- `/patterns` – Alle Patterns auflisten
- `/history` – Chat-Verlauf anzeigen
- `/clear` – Verlauf löschen
- `/exit` oder `/quit` – Session beenden

### Alle Befehle

```bash
aios "Aufgabe"                         # Automatischer Workflow
aios "Aufgabe" --dry-run               # Nur Plan anzeigen
aios "Aufgabe" --provider ollama        # Anderer LLM-Provider

echo "text" | aios run <pattern>       # Ein Pattern direkt
echo "text" | aios run <p> --key=value # Mit Parametern

aios chat                              # Interaktive Chat-Session
aios chat --provider ollama            # Chat mit anderem Provider

aios plan "Aufgabe"                    # Nur planen (JSON)
aios patterns list                     # 34+ Patterns anzeigen
aios patterns search "security"        # Suchen
aios patterns show code_review         # Details + Prompt
aios patterns create my_pattern        # Neues Pattern erstellen
```

(`aios` = `npx tsx src/cli.ts`)

### Eigenes Pattern erstellen

```bash
$ npx tsx src/cli.ts patterns create api_validator --category=review
Pattern "api_validator" erstellt: patterns/api_validator/system.md
```

Die Datei bearbeiten – fertig. Beim nächsten Aufruf ist das Pattern verfügbar,
auch für den Router:

```markdown
---
name: api_validator
description: "Validiert API-Specs gegen REST-Best-Practices"
category: review
input_type: api_spec
output_type: findings
tags: [api, rest, validation]
persona: architect
---

# AUFGABE
Validiere die API-Spezifikation gegen REST-Best-Practices.

# STEPS
1. Prüfe URL-Struktur (Ressourcen-orientiert)
2. Prüfe HTTP-Methoden und Status Codes
3. Prüfe Versionierung und Fehlerbehandlung

# OUTPUT FORMAT
Pro Endpoint: ✅ OK | ⚠️ WARNING | ❌ VIOLATION mit Fix-Vorschlag.
```

### Konfiguration (`aios.yaml`)

```yaml
providers:
  claude:
    type: anthropic
    model: claude-sonnet-4-20250514
    capabilities: [vision, text, code]
    cost_per_mtok: 3.0
  ollama:
    type: ollama
    model: llama3.2
    endpoint: http://localhost:11434
  ollama-vision:
    type: ollama
    model: minicpm-v
    endpoint: http://localhost:11434
    capabilities: [vision]
    cost_per_mtok: 0
  gemini-flash:
    type: gemini
    model: gemini-2.0-flash
    apiKey: ${GEMINI_API_KEY}
    capabilities: [vision, text]
    cost_per_mtok: 0.075
  openai-mini:
    type: openai
    model: gpt-4o-mini
    apiKey: ${OPENAI_API_KEY}
    capabilities: [vision, text]
    cost_per_mtok: 0.15

defaults:
  provider: claude

paths:
  patterns: ./patterns
  personas: ./personas

tools:
  output_dir: ./output
  allowed: [mmdc]  # Allowlist für externe CLI-Tools

mcp:
  servers:
    pdftools:
      command: node
      args: ["/path/to/mcp-server/dist/index.js"]
      category: pdf
      prefix: pdf
      exclude: [pdf_ocr]  # Tools die nicht registriert werden
```

### LLM-Provider

AIOS unterstützt vier Provider-Typen. Jeder Provider kann `capabilities` und `cost_per_mtok` deklarieren.
Die Engine wählt automatisch den **günstigsten** verfügbaren Provider für spezielle Anforderungen (z.B. Vision):

```
Ollama (kostenlos) → Gemini Flash (0.075) → GPT-4o-mini (0.15) → Claude Sonnet (3.0)
```

Provider ohne gesetzten API-Key werden automatisch übersprungen.

| Provider | Typ | Besonderheit |
|----------|-----|-------------|
| Anthropic (Claude) | `anthropic` | Anthropic SDK, Vision via multimodal Content Blocks |
| Ollama | `ollama` | Lokale Modelle, optional Bearer-Auth für Remote-Server |
| Google Gemini | `gemini` | REST API mit API-Key, Vision via `inlineData` |
| OpenAI | `openai` | OpenAI-kompatibel (auch Custom-Endpoints), Vision via `image_url` |

```bash
# Ollama installieren: https://ollama.ai
ollama pull llama3.2

# In aios.yaml: defaults.provider auf "ollama" setzen
# Oder per CLI:
npx tsx src/cli.ts --provider ollama "Fasse zusammen"
```

### MCP-Server (Model Context Protocol)

AIOS kann externe Tools über MCP-Server einbinden. MCP-Tools werden beim Start automatisch
als Patterns registriert und stehen dem Router zur Verfügung.

```yaml
# aios.yaml
mcp:
  servers:
    pdftools:
      command: node
      args: ["/path/to/mcp-server/dist/index.js"]
      category: pdf
      prefix: pdf
      exclude: [pdf_ocr]  # Bestimmte Tools ausschließen
```

MCP-Tools erscheinen als `[MCP]`-Patterns in `aios patterns list` und können direkt
oder in automatischen Workflows verwendet werden:

```bash
# MCP-Tool direkt aufrufen
echo '{"file_path": "/path/to/doc.pdf"}' | aios run pdf/pdf_extract_text

# Router plant MCP-Tools automatisch ein
aios "Extrahiere den Text aus report.pdf und fasse ihn zusammen"
```

### RAG (Retrieval-Augmented Generation)

Semantische Suche über eigene Datenbestände. AIOS unterstützt lokale Embeddings
(Transformers.js) und Ollama-Embeddings mit konfigurierbaren Collections:

```yaml
# aios.yaml
rag:
  defaultProvider: local
  defaultModel: Xenova/all-MiniLM-L6-v2
  collections:
    my-docs:
      preprocessing:
        maxChunkLength: 500
        chunkStrategy: truncate
        cleaners: [stripHtml, normalizeWhitespace]
      search:
        minRelevance: 0.3
        topK: 20
```

RAG-Patterns (`rag_search`, `rag_index`) werden vom Router in Workflows integriert,
z.B. um vor einer Analyse relevante Dokumente aus einer Knowledge Base zu finden.

### Vision / OCR

PDF-Seiten als Bilder analysieren, ohne Tesseract. Die Engine leitet Bilder aus
vorherigen Steps (z.B. `pdf_thumbnails`) automatisch an einen Vision-fähigen LLM-Provider weiter.

```bash
# Router plant automatisch: pdf_thumbnails → pdf_vision_ocr → summarize
aios "Analysiere die Seiten in report.pdf und fasse den Inhalt zusammen"
```

Der **ProviderSelector** wählt den günstigsten Provider mit `capabilities: [vision]`.
Lokales Ollama-Modell (z.B. `minicpm-v`, Kosten: 0) wird bevorzugt; wenn nicht
verfügbar, fällt das System auf Gemini Flash, GPT-4o-mini oder Claude zurück.

### Die 34 Patterns

Alle Patterns auflisten: `npx tsx src/cli.ts patterns list`

| Kategorie | Patterns | Beispiel |
|-----------|---------|---------|
| **analyze** | `extract_requirements`, `gap_analysis`, `identify_risks`, `threat_model` | `cat spec.md \| aios run extract_requirements` |
| **generate** | `generate_code`, `generate_tests`, `generate_docs`, `generate_adr`, `generate_diagram`, `design_solution`, `write_architecture_doc`, `write_user_doc`, `generate_image_prompt` | `cat design.md \| aios run generate_code` |
| **review** | `code_review`, `security_review`, `architecture_review`, `requirements_review`, `test_review` | `cat app.ts \| aios run code_review` |
| **transform** | `summarize`, `refactor`, `translate_technical`, `simplify_text`, `formalize` | `cat notes.txt \| aios run formalize` |
| **report** | `aggregate_reviews`, `compliance_report`, `test_report`, `risk_report` | `cat results.json \| aios run test_report` |
| **tool** | `render_diagram` (mmdc), `render_image` (DALL-E/Stability) | `echo "graph TD;A-->B" \| aios run render_diagram` |
| **pdf** | `pdf_vision_ocr` + MCP-Tools (`pdf_extract_text`, `pdf_thumbnails`, ...) | `aios "OCR auf report.pdf"` |
| **rag** | `rag_search`, `rag_index` | `echo "query" \| aios run rag_search` |
| **meta** | `evaluate_quality`, `extract_knowledge` | (intern, vom Router verwendet) |

Details zu einem Pattern: `npx tsx src/cli.ts patterns show security_review`

---

## Ich will es weiterentwickeln

### Architektur in 30 Sekunden

```
User: "Review Code auf Security"
  │
  ├─ 1. Registry    lädt patterns/*/system.md + MCP-Tools → Katalog
  ├─ 2. Router      LLM-Call: Aufgabe + Katalog → JSON Plan
  └─ 3. Engine      führt Plan aus: Promise.all, Retry, Rollback
       ├─ LLM-Steps     → Provider (Claude/Ollama/Gemini/OpenAI)
       ├─ MCP-Steps      → MCP-Server (externe Tools)
       ├─ RAG-Steps      → Vector Store (Semantic Search)
       └─ Vision-Steps   → ProviderSelector (günstigster Vision-Provider)
```

**Persona = WER** (Rolle, Expertise) → `personas/*.yaml`
**Pattern = WAS** (Aufgabe, Steps, Output-Format) → `patterns/*/system.md`

Zur Laufzeit: `system_prompt = persona.system_prompt + pattern.systemPrompt`

### Projektstruktur

```
src/
├── cli.ts                       # CLI Entry Point (Commander.js)
├── types.ts                     # Alle TypeScript Interfaces
├── core/
│   ├── registry.ts              # Pattern Registry – lädt system.md, baut Katalog
│   ├── personas.ts              # Persona Registry – lädt YAML-Dateien
│   ├── router.ts                # Router – LLM-Call der Execution Plans erzeugt
│   ├── engine.ts                # Engine – DAG-Ausführung, Retry, Saga Rollback, Vision
│   ├── mcp.ts                   # MCP-Server Management + Tool-Registration
│   ├── repl.ts                  # Interaktive Chat-Session (REPL Loop)
│   ├── slash.ts                 # Slash-Command Parser (/command --key=value)
│   └── knowledge.ts             # Knowledge Base – SQLite (Decisions, Facts, Requirements)
├── agents/
│   ├── provider.ts              # LLM Provider Interface + Claude/Ollama
│   ├── gemini-provider.ts       # Google Gemini REST Provider
│   ├── openai-provider.ts       # OpenAI-kompatibler REST Provider
│   └── provider-selector.ts     # Kostenbasierte Provider-Auswahl nach Capability
├── rag/
│   ├── rag-service.ts           # RAG Service – Search, Index, Compare
│   ├── vector-store.ts          # In-Memory Vector Store
│   └── preprocessing.ts         # Chunking, Cleaning, Embedding
└── utils/
    ├── config.ts                # YAML Config Loader
    └── stdin.ts                 # stdin Helper

patterns/*/system.md             # 34 Patterns (YAML-Frontmatter + Prompt)
personas/*.yaml                  # 8 Personas (RE, Architect, Developer, Tester, ...)
```

### Tech Stack

| Was | Womit |
|-----|-------|
| Runtime | Node.js 20+, TypeScript (ESM, strict) |
| CLI | Commander.js + chalk |
| LLM | Anthropic SDK, Ollama REST, Gemini REST, OpenAI REST |
| MCP | @modelcontextprotocol/sdk (Model Context Protocol) |
| RAG | Transformers.js (lokale Embeddings) + Ollama Embeddings |
| Patterns | gray-matter (YAML-Frontmatter aus Markdown) |
| Config | yaml + dotenv |
| Knowledge Base | better-sqlite3 |
| Tests | vitest (153 Tests) |

### Tests

```bash
npx vitest run          # Alle Tests
npx vitest run --watch  # Watch-Modus
```

### Workflow-Typen (Enterprise Integration Patterns)

Die Engine implementiert diese EIP-Patterns aus
[Hohpe/Woolf](https://www.enterpriseintegrationpatterns.com/):

| EIP-Pattern | AIOS-Umsetzung |
|-------------|---------------|
| Pipes and Filters | Unix-Pipes: `aios run p1 \| aios run p2` |
| Content-Based Router | Router analysiert Aufgabe → wählt Patterns |
| Scatter-Gather | Parallele Reviews + Aggregation |
| Process Manager | DAG mit topologischer Sortierung |
| Saga | Retry → Escalation → Rollback (Kompensation) |
| Aggregator | `aggregate_reviews` Pattern |
| Claim Check | Tool-Patterns: Input → Temp-Datei → CLI-Tool → Output-Datei |

### Was will ich tun? → Wo muss ich hin?

| Ich will... | Was ich anlege/ändere | Beispiel |
|------------|----------------------|---------|
| **Neues Prompt-Template** | `patterns/my_pattern/system.md` anlegen | Neues Review für API-Specs |
| **Neue Rolle/Expertise** | `personas/my_role.yaml` anlegen | DevOps Engineer, Data Scientist |
| **Persona einem Pattern zuweisen** | `persona: my_role` in Pattern-Frontmatter | Pattern nutzt jetzt die Rolle |
| **Neuen LLM-Provider** | Klasse in `src/agents/` + Factory in `provider.ts` | Bereits: Claude, Ollama, Gemini, OpenAI |
| **Chat-Verhalten anpassen** | `src/core/repl.ts` (REPL Loop, Slash-Commands) | Neue Built-in Commands, Auto-Routing |
| **Neuen CLI-Befehl** | Command in `src/cli.ts` (Commander.js) | `aios knowledge search` |
| **Workflow-Logik ändern** | `src/core/engine.ts` | Neuer Retry-Modus, Timeout |
| **Router-Verhalten anpassen** | `patterns/_router/system.md` oder `src/core/router.ts` | Andere Planungs-Regeln |
| **Wissen speichern/abfragen** | `src/core/knowledge.ts` (KnowledgeBase) | Neue Query-Methoden |
| **CLI-Tool einbinden** | Tool-Pattern anlegen + `aios.yaml` Allowlist | Prettier, ESLint, Terraform |
| **MCP-Server anbinden** | `mcp.servers` in `aios.yaml` konfigurieren | PDFTools, Azure DevOps, DB-Tools |
| **Semantic Search (RAG)** | `rag.collections` in `aios.yaml` + RAG-Patterns nutzen | Dokument-Suche, Work-Item-Matching |
| **Neues Frontmatter-Feld** | `PatternMeta` in `src/types.ts` + Parser in `src/core/registry.ts` | `estimated_tokens`, `timeout` |

### Die häufigsten Erweiterungen im Detail

**Neues Pattern (häufigstes Szenario – kein Code nötig):**
```bash
npx tsx src/cli.ts patterns create api_validator --category=review
# → patterns/api_validator/system.md bearbeiten
# → Fertig. Router sieht es automatisch.
```

**Neue Persona:**
```yaml
# personas/devops.yaml
name: DevOps Engineer
id: devops
role: CI/CD & Infrastructure
description: >
  Expertise in Docker, Kubernetes, Terraform, GitHub Actions.
system_prompt: |
  Du bist ein DevOps Engineer mit Fokus auf CI/CD Pipelines,
  Infrastructure as Code und Container-Orchestrierung.
  Du achtest auf Reproduzierbarkeit, Security und Kosten.
expertise: [ci-cd, docker, kubernetes, terraform]
preferred_patterns: [generate_code, code_review]
communicates_with: [developer, security_expert]
```

**Neues Tool-Pattern (CLI-Tool als Pattern):**
```markdown
---
name: lint_code
type: tool
tool: eslint
tool_args: ["--format", "json", "$INPUT"]
input_format: js
output_format: [json]
description: "ESLint auf Code ausführen"
category: tool
tags: [lint, quality]
---
```
Dann in `aios.yaml`: `tools.allowed: [..., eslint]`

**Neuer LLM-Provider:**
1. Klasse in `src/agents/` mit Interface `complete(system, user, images?)` + `chat(system, messages, images?)` → `LLMResponse`
2. In `createProvider()` Factory registrieren (`src/agents/provider.ts`)
3. In `aios.yaml` konfigurieren mit `capabilities` und `cost_per_mtok`
4. Bereits eingebaut: `anthropic`, `ollama`, `gemini`, `openai`

### Weiterführende Docs

| Dokument | Inhalt |
|----------|--------|
| [Architektur](docs/ARCHITECTURE.md) | Komponenten, Datenfluss, Mermaid-Diagramme, Router-Mechanik, dynamische Orchestrierung |
| [Patterns](docs/PATTERNS.md) | Frontmatter-Schema, Kompositions-Regeln |
| [Workflows](docs/WORKFLOWS.md) | EIP-Patterns im Detail mit Zeitdiagrammen |
| [Personas](docs/PERSONAS.md) | 8 Personas, Team-Interaktionsdiagramm |
| [Phasenplan](docs/PHASES.md) | 6 Phasen – was ist done, was fehlt |
| [Compliance](docs/REGULATED.md) | Traceability, Audit Trail, Quality Gates (Zielbild) |
| [Vision](docs/VISION.md) | Gesamtvision und Prinzipien |

---

## Lizenz

MIT
