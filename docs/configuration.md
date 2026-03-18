# Configuration

> **Audience:** Users + Operators

## Config Sources

AIOS loads configuration from multiple sources in priority order (higher wins):

| Priority | Source | Purpose |
|----------|--------|---------|
| 1 (highest) | `./aios.yaml` | Project-local overrides |
| 2 | `~/.aios/config.yaml` | User-global defaults |
| 3 | Built-in defaults | Fallback values |

Settings from higher-priority sources override lower ones. Place shared team config in the project directory and personal preferences in the global file.

## Full Annotated Example

```yaml
# ─── LLM Providers ──────────────────────────────────────
providers:
  claude:
    type: anthropic                    # Provider class: anthropic
    model: claude-sonnet-4-20250514
    capabilities: [vision, text, code] # Used by ProviderSelector
    cost_per_mtok: 3.0                 # USD per million tokens (for cost-based selection)

  ollama:
    type: ollama                       # Provider class: ollama
    model: qwen2.5:72b
    endpoint: http://localhost:11434   # Ollama API endpoint
    apiKey: your-bearer-token          # Optional Bearer auth for remote Ollama

  ollama-vision:
    type: ollama
    model: minicpm-v
    endpoint: http://localhost:11434
    capabilities: [vision]             # Vision-capable model for OCR tasks
    cost_per_mtok: 0                   # Local models = zero cost

  gemini-flash:
    type: gemini                       # Provider class: gemini
    model: gemini-2.0-flash
    apiKey: ${GEMINI_API_KEY}          # Resolved from environment variable
    capabilities: [vision, text]
    cost_per_mtok: 0.075

  openai-mini:
    type: openai                       # Provider class: openai
    model: gpt-4o-mini
    apiKey: ${OPENAI_API_KEY}
    capabilities: [vision, text]
    cost_per_mtok: 0.15

# ─── Defaults ────────────────────────────────────────────
defaults:
  provider: claude                     # Default provider for all LLM calls

# ─── Paths ───────────────────────────────────────────────
paths:
  patterns: ./patterns                 # Directory containing pattern definitions
  personas: ./personas                 # Directory containing persona definitions

# ─── Tools ───────────────────────────────────────────────
tools:
  output_dir: ./output                 # Where tool patterns write output files
  allowed: [mmdc]                      # Allowlist of permitted CLI tools

# ─── MCP Servers ─────────────────────────────────────────
mcp:
  servers:
    pdftools:
      command: node
      args: ["/path/to/mcp-server/dist/index.js"]
      category: pdf                    # Pattern category for discovered tools
      prefix: pdf                      # Prefix for pattern names (e.g., pdf_merge)
      description: "PDFTools – PDF operations"
      exclude: [pdf_ocr]              # Tools to skip during registration
      env:
        MCP_PDFTOOLS_VENV: "/path/to/venv/bin/python"

# ─── RAG ─────────────────────────────────────────────────
rag:
  defaultProvider: local               # "local" (Transformers.js) or "ollama"
  defaultModel: Xenova/all-MiniLM-L6-v2
  ollama:
    model: all-minilm
    endpoint: http://localhost:11434
  collections:
    my-docs:
      preprocessing:
        maxChunkLength: 500
        chunkStrategy: truncate        # or sliding_window
        cleaners: [stripHtml, normalizeWhitespace]
        fields: [title, description]
      search:
        minRelevance: 0.3
        topK: 20
```

## Provider Configuration

The `type` field determines which provider class is instantiated:

| Type | Class | Auth | Notes |
|------|-------|------|-------|
| `anthropic` | ClaudeProvider | `ANTHROPIC_API_KEY` env var | Default for high-quality tasks |
| `ollama` | OllamaProvider | Optional Bearer token via `apiKey` | Local or remote, zero cost |
| `gemini` | GeminiProvider | `apiKey` field (env var ref) | Fast, low cost, vision-capable |
| `openai` | OpenAIProvider | `apiKey` field (env var ref) | GPT models |

The `capabilities` array and `cost_per_mtok` field feed into the ProviderSelector, which automatically picks the cheapest provider that satisfies a task's requirements (e.g., vision capability).

API keys can reference environment variables using `${VAR_NAME}` syntax. These are resolved at startup.

## MCP Server Configuration

Each entry under `mcp.servers` defines an external tool server using the Model Context Protocol.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | yes | Executable to launch (e.g., `node`, `python`) |
| `args` | string[] | no | Command-line arguments |
| `env` | Record | no | Environment variables passed to the process |
| `category` | string | no | Pattern category (default: `mcp`) |
| `prefix` | string | no | Prefix for pattern names (default: server key) |
| `description` | string | no | Human-readable description for the pattern catalog |
| `exclude` | string[] | no | Tool names to skip during registration |

MCP servers are started on demand. Their tools are discovered automatically and registered as patterns. Use `aios patterns list` to see registered MCP tools.

## RAG Configuration

See [rag.md](rag.md) for full RAG documentation.

- `defaultProvider` — `local` uses Transformers.js (no external service), `ollama` uses a running Ollama instance.
- `defaultModel` — Embedding model identifier. For local: a HuggingFace model ID. For Ollama: the model name.
- `collections` — Named collections with independent preprocessing and search settings.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Authentication for Claude/Anthropic provider |
| `GEMINI_API_KEY` | Authentication for Google Gemini provider |
| `OPENAI_API_KEY` | Authentication for OpenAI provider |

AIOS loads `.env` files automatically via dotenv. Place a `.env` file in the project root:

```
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...
OPENAI_API_KEY=sk-...
```

## Security

- Never store API keys or tokens directly in `aios.yaml` if the file is tracked in version control.
- Use `${ENV_VAR}` references in `aios.yaml` and keep actual secrets in `.env` or an external secret manager.
- Add `.env` to `.gitignore`.
- The `tools.allowed` list restricts which CLI tools can be invoked by tool patterns. Only allow tools you trust.
