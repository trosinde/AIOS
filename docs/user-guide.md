> **Audience:** Users

# AIOS User Guide

> **Voraussetzung:** AIOS ist installiert und konfiguriert. Falls nicht: [Getting Started](getting-started.md).

---

## Running a Single Pattern

Pipe input via stdin and specify a pattern by name:

```bash
echo "Large block of text..." | aios run summarize
```

Patterns accept parameters as `--key=value` flags:

```bash
echo "Text" | aios run translate_technical --language=fr
```

Results go to **stdout**; logs and progress go to **stderr**. This makes AIOS fully Unix-pipe compatible.

### Pattern Pipes

Chain patterns together using standard shell pipes. Each pattern's stdout becomes the next pattern's stdin:

```bash
cat spec.md | aios run extract_requirements | aios run identify_risks | aios run risk_report
```

This is equivalent to a manual pipeline: extract requirements, identify risks, then produce a risk report.

---

## Automatic Workflows

Describe a task in natural language. AIOS analyzes it, selects patterns, and builds a DAG execution plan:

```bash
aios "Review this TypeScript module for security issues and code quality"
```

You can combine a task description with stdin:

```bash
aios "Summarize and translate to French" < document.md
```

### Dry Run

Preview the execution plan without running it:

```bash
aios "Generate architecture docs for this codebase" --dry-run < src/main.ts
```

The plan is printed as JSON showing step IDs, patterns, dependencies, and parallel groups.

### Plan Only

The `plan` command produces a plan and exits (same as `--dry-run`):

```bash
aios plan "Analyze and refactor this module"
```

---

## Interactive Chat Mode

Start an interactive REPL session:

```bash
aios chat
```

In chat mode you can type natural language or use slash commands.

### Slash Commands

| Command | Description |
|---|---|
| `/<pattern> [text] [--key=value]` | Run a pattern directly (e.g., `/summarize My text`) |
| `/help` | Show available commands |
| `/patterns` | List all available patterns |
| `/history` | Show chat history for the current session |
| `/clear` | Clear chat history |
| `/mcp list\|tools\|add\|remove\|reload` | Manage MCP servers at runtime |
| `/exit` | End the session |

Example session:

```
aios> /summarize The quick brown fox jumps over the lazy dog near the river bank
aios> What patterns can help me review code?
aios> /security_review < my_file.ts
aios> /exit
```

---

## Pattern Management

### List All Patterns

```bash
aios patterns list
```

Patterns are grouped by category. Filter by category:

```bash
aios patterns list --category analysis
```

### Search Patterns

Search by name, description, or tags:

```bash
aios patterns search security
```

### Show Pattern Details

Display metadata, parameters, prompt, and pipeline hints:

```bash
aios patterns show code_review
```

### Create a New Pattern

Scaffold a new pattern from a template:

```bash
aios patterns create my_pattern --category analysis --description "My custom analysis"
```

This creates `patterns/my_pattern/system.md` with a starter template. Edit the file to define your prompt.

---

## Provider Override

AIOS uses the default provider from `aios.yaml`. Override per command:

```bash
echo "text" | aios run summarize --provider ollama
aios "Analyze this code" --provider ollama < file.ts
aios chat --provider ollama
```

Providers are configured in `aios.yaml` under the `providers` key. Common types: `anthropic` (Claude) and `ollama` (local models).

---

## MCP Tools in Workflows

MCP (Model Context Protocol) servers expose external tools -- Azure DevOps, PDF processing, databases, etc. AIOS registers MCP tools as virtual patterns at startup.

The Router plans MCP tool calls automatically when they match the task:

```bash
aios "Get work item 42 from Azure DevOps and summarize it"
```

You can also call MCP tools directly:

```bash
echo '{"id": 42}' | aios run azdo/get_work_item
```

MCP servers are configured in `aios.yaml` under `mcp.servers`. Tools can be excluded per server via the `exclude` list.

Manage MCP servers at runtime in chat mode:

```
aios> /mcp list
aios> /mcp tools azdo
aios> /mcp reload
```

---

## RAG Patterns

AIOS includes built-in RAG (Retrieval-Augmented Generation) patterns backed by a vector store.

### Index Documents

```bash
echo '{"path": "./docs"}' | aios run rag_index
```

### Search and Query

```bash
echo "How does the engine handle retries?" | aios run rag_search
```

The Router can also plan RAG steps automatically when a task requires knowledge retrieval.

---

## Vision and OCR

For PDF and image analysis, the Router automatically plans multi-step workflows:

```
pdf_thumbnails  -->  pdf_vision_ocr  -->  summarize
```

Provide a PDF or image as input, describe what you need, and AIOS handles the pipeline:

```bash
aios "Extract and summarize the text from this PDF" < report.pdf
```

This requires an MCP server for PDF processing (e.g., `pdftools`) configured in `aios.yaml`.

---

## Output Conventions

AIOS follows Unix conventions:

- **stdout** -- pattern output (results, generated text, JSON)
- **stderr** -- progress messages, plan details, warnings

This means you can safely redirect or pipe output:

```bash
aios "Analyze this code" < main.ts > analysis.md
aios "Analyze this code" < main.ts 2>/dev/null | aios run simplify_text
```

When a pattern produces a file (diagrams, images), the file path is printed to stderr and the content goes to stdout.

---

## CLI Reference

| Command | Description |
|---|---|
| `aios "<task>"` | Automatic workflow: plan and execute from natural language |
| `aios "<task>" --dry-run` | Plan only, print execution plan as JSON |
| `aios "<task>" --provider <name>` | Override LLM provider |
| `aios run <pattern>` | Run a single pattern (stdin required) |
| `aios run <pattern> --key=value` | Run a pattern with parameters |
| `aios run <pattern> --provider <name>` | Run a pattern with a specific provider |
| `aios plan "<task>"` | Generate execution plan without running it |
| `aios plan "<task>" --provider <name>` | Plan with a specific provider |
| `aios chat` | Start interactive REPL |
| `aios chat --provider <name>` | Start REPL with a specific provider |
| `aios patterns list` | List all patterns grouped by category |
| `aios patterns list --category <cat>` | List patterns in a category |
| `aios patterns search <query>` | Search patterns by name, description, or tags |
| `aios patterns show <name>` | Show pattern details and prompt |
| `aios patterns create <name>` | Create a new pattern from template |
| `aios patterns create <name> --category <cat>` | Create with a specific category |

---

## See Also

- [Getting Started](getting-started.md) -- installation and first steps
- [Patterns](PATTERNS.md) -- pattern format and authoring guide
- [Architecture](ARCHITECTURE.md) -- system design and data flow
- [Workflows](WORKFLOWS.md) -- execution plan types (pipe, scatter-gather, DAG, saga)
- [MCP](MCP.md) -- MCP server configuration and tool integration
