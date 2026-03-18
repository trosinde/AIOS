> **Audience:** Developers

# Pattern Specification and Catalog

## What Are Patterns?

Patterns are reusable prompt templates inspired by [Fabric](https://github.com/danielmiessler/fabric). Each pattern is a Markdown file with YAML frontmatter (metadata) followed by a system prompt. Patterns live in `patterns/<name>/system.md` and are loaded at runtime by the Pattern Registry (`core/registry.ts`).

Key principles:

- **One file, one concern.** Each pattern encapsulates a single task (extract requirements, review code, render a diagram).
- **Composable.** Patterns declare which other patterns they can follow or precede, enabling the Router to chain them into workflows.
- **Typed.** A pattern can be an LLM call, a CLI tool invocation, an MCP server call, or a RAG vector-store operation. The engine dispatches accordingly.
- **Parameterized.** Patterns accept runtime parameters (e.g. `--standard=iec62443`) that customize behavior without changing the prompt file.

---

## Pattern Format

A pattern file consists of YAML frontmatter delimited by `---`, followed by a Markdown system prompt. The prompt typically uses the sections IDENTITY, GOAL, STEPS, OUTPUT FORMAT, and INPUT.

### Full Example: `extract_requirements`

```markdown
---
name: extract_requirements
version: "1.0"
description: "Extract structured requirements from natural-language input"
category: analyze
type: llm
input_type: text
output_type: structured
tags: [requirements, analysis, regulated]
parameters:
  - name: standard
    type: enum
    values: [iec62443, cra, generic]
    default: generic
  - name: detail_level
    type: enum
    values: [high, medium, low]
    default: high
preferred_provider: claude
---

# IDENTITY

You are a requirements analysis expert.

# GOAL

Extract structured requirements from the given input.

# STEPS

1. Read the input completely
2. Identify functional and non-functional requirements
3. Classify by type and priority
4. Formulate clear acceptance criteria
5. Identify gaps and open questions

# OUTPUT FORMAT

Return results as a Markdown table:

| REQ-ID | Type | Description | Acceptance Criteria | Priority | Risk |
|--------|------|-------------|---------------------|----------|------|

Followed by:
- Open questions
- Identified gaps
- Recommendations

# INPUT
```

---

## Frontmatter Schema

### Core Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | -- | Unique identifier, matches directory name |
| `version` | string | no | -- | Semantic version |
| `description` | string | yes | -- | One-line summary shown in pattern catalog |
| `category` | string | yes | -- | Grouping key: `analyze`, `generate`, `review`, `transform`, `report`, `pdf`, `rag`, `tool`, `meta` |
| `input_type` | string | yes | -- | Expected input: `text`, `json`, `image` |
| `output_type` | string | yes | -- | Output kind: `text`, `structured`, `code`, `diagram` |
| `tags` | string[] | yes | -- | Searchable tags |
| `type` | enum | no | `llm` | Execution type: `llm`, `tool`, `mcp`, `rag` |
| `persona` | string | no | -- | Default persona ID to use for this pattern |
| `preferred_provider` | string | no | -- | LLM provider hint (e.g. `claude`, `ollama`) |
| `internal` | boolean | no | `false` | If `true`, hidden from user-facing listings |
| `parameters` | array | no | -- | Runtime parameters (see below) |

### Parameter Object

Each entry in the `parameters` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Parameter name, used on CLI: `--name=value` |
| `type` | enum | yes | `string`, `enum`, `number`, `boolean` |
| `description` | string | no | Help text |
| `values` | string[] | conditional | Required when `type: enum` |
| `default` | any | no | Default value if not provided |
| `required` | boolean | no | Whether the parameter must be supplied |

### Composition Fields

| Field | Type | Description |
|-------|------|-------------|
| `can_follow` | string[] | Patterns whose output this pattern accepts as input |
| `can_precede` | string[] | Patterns that can consume this pattern's output |
| `parallelizable_with` | string[] | Patterns safe to run in parallel alongside this one |

### Tool-Pattern Fields (type: tool)

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `tool` | string | CLI executable name | `mmdc`, `render-image` |
| `tool_args` | string[] | Argument template; `$INPUT` and `$OUTPUT` are replaced at runtime | `["-i", "$INPUT", "-o", "$OUTPUT"]` |
| `input_format` | string | Expected input file extension | `mmd`, `txt` |
| `output_format` | string[] | Possible output formats | `[svg, png, pdf]` |

### MCP-Pattern Fields (type: mcp)

| Field | Type | Description |
|-------|------|-------------|
| `mcp_server` | string | Server name from `aios.config.json` MCP section |
| `mcp_tool` | string | Original MCP tool name on that server |
| `mcp_input_schema` | object | JSON Schema describing the tool's expected arguments |

### RAG-Pattern Fields (type: rag)

| Field | Type | Description |
|-------|------|-------------|
| `rag_collection` | string | Target vector-store collection name |
| `rag_operation` | enum | `search`, `index`, or `compare` |
| `rag_overrides` | object | Optional `{ topK?: number, minRelevance?: number }` |

---

## Pattern Types

### LLM Pattern (text -> LLM -> text)

The default type. Input text is sent to an LLM with the pattern's system prompt. The LLM response is the output. Most patterns are LLM patterns.

```
stdin/text --> [LLM Provider] --> stdout/text
               system.md prompt
```

### Tool Pattern (text -> CLI tool -> file)

Invokes an external CLI tool instead of an LLM. The engine writes input to a temp file, runs the tool, and reads the output file. Tool patterns are typically chained after an LLM pattern (e.g. `generate_diagram` -> `render_diagram`).

```
temp-input.mmd --> [mmdc -i $INPUT -o $OUTPUT] --> output.svg
```

### MCP Pattern (JSON -> MCP server -> text)

Calls a tool on a Model Context Protocol server. MCP patterns are auto-registered when an MCP server is configured in `aios.config.json`. The engine sends structured JSON arguments and receives the tool's response.

```
JSON args --> [MCP Server / Tool] --> text response
```

### RAG Pattern (query -> vector store -> text)

Performs a semantic search or indexing operation against a vector store. The `rag_collection` is set by the Router at plan time. The engine delegates to the RAG subsystem.

```
natural-language query --> [Embedding + Vector Search] --> ranked results
```

---

## Pattern Catalog

### Analyze (4 patterns)

| Pattern | Description | Input | Output |
|---------|-------------|-------|--------|
| `extract_requirements` | Extract structured requirements from text | Free text, specs | Structured requirements |
| `gap_analysis` | Identify gaps between current and target state | Document + reference | Gap report |
| `identify_risks` | Identify and assess risks | Requirements, design | Risk register |
| `threat_model` | Create a STRIDE threat model | Design docs | Threat model |

### Generate (9 patterns)

| Pattern | Description | Input | Output |
|---------|-------------|-------|--------|
| `design_solution` | Technical design from requirements | Requirements | Design specification |
| `generate_adr` | Architecture Decision Record | Decision context | ADR (Markdown) |
| `generate_code` | Code from specification | Design doc, interface spec | Source code |
| `generate_diagram` | Mermaid diagram code | Description, design doc | Mermaid code |
| `generate_docs` | Technical documentation | Code, design | Technical docs |
| `generate_image_prompt` | Optimize image description for generation | Image description | Detailed prompt |
| `generate_tests` | Test cases and test code | Requirements, code | Test cases / test code |
| `write_architecture_doc` | Architecture documentation from code | Source code, concept docs | Architecture document |
| `write_user_doc` | User documentation with install and examples | Code, README | User documentation |

### Review (5 patterns)

| Pattern | Description | Input | Output |
|---------|-------------|-------|--------|
| `architecture_review` | Evaluate architecture aspects | Design docs, code | Architecture assessment |
| `code_review` | Systematic code review with categorized findings | Source code | Review comments |
| `requirements_review` | Check requirements for quality and testability | Requirements | Review with improvements |
| `security_review` | Security-focused review (OWASP, IEC 62443) | Code, config | Security findings |
| `test_review` | Assess test coverage and test quality | Tests + requirements | Coverage analysis |

### Transform (5 patterns)

| Pattern | Description | Input | Output |
|---------|-------------|-------|--------|
| `formalize` | Convert informal notes into formal documents | Notes, emails | Formal document |
| `refactor` | Refactor code by clean-code principles | Code + goal | Refactored code |
| `simplify_text` | Simplify complex technical text | Technical text | Simplified version |
| `summarize` | Create a concise summary | Any text | Summary |
| `translate_technical` | Technical translation preserving domain terms | Text + target language | Translated text |

### Report (4 patterns)

| Pattern | Description | Input | Output |
|---------|-------------|-------|--------|
| `aggregate_reviews` | Consolidate multiple review results | Multiple reviews | Consolidated report |
| `compliance_report` | Compliance report (IEC 62443 / CRA) | All artifacts | Compliance report |
| `risk_report` | Management-ready risk report | Risk register | Management summary |
| `test_report` | Formal test report from test results | Test results | Formal test report |

### PDF (1 LLM pattern + MCP patterns)

| Pattern | Type | Description | Input | Output |
|---------|------|-------------|-------|--------|
| `pdf_vision_ocr` | llm | Analyze PDF pages as images via Vision LLM | Page images | Extracted text |
| `pdf/*` | mcp | MCP-based PDF tools (thumbnails, text extraction, etc.) | PDF files | Text / images |

### RAG (2 patterns)

| Pattern | Type | Description | Input | Output |
|---------|------|-------------|-------|--------|
| `rag_search` | rag | Semantic search across a RAG collection | Natural-language query | Ranked results |
| `rag_index` | rag | Index documents into a RAG collection | JSON array of items | Index confirmation |

### Tool (2 patterns)

| Pattern | Type | Tool | Input | Output |
|---------|------|------|-------|--------|
| `render_diagram` | tool | `mmdc` | Mermaid code (.mmd) | SVG, PNG, PDF |
| `render_image` | tool | `render-image` | Image prompt (.txt) | PNG, WebP |

### Meta (3 patterns)

| Pattern | Description | Input | Output |
|---------|-------------|-------|--------|
| `_router` | Meta-agent: analyze tasks and create execution plans | Task description | Execution plan (JSON) |
| `evaluate_quality` | Evaluate quality of an agent's output (1-10) | Agent output | Quality score + feedback |
| `extract_knowledge` | Extract reusable knowledge from agent outputs | Agent output | Knowledge items |

---

## Creating Patterns

### Interactive

```bash
aios patterns create my_pattern
# Editor opens with a template
# Pattern is validated
# Pattern is registered
```

### Manual

Create `patterns/my_pattern/system.md` with the format shown above. The pattern will be picked up automatically on the next run.

### Composition via YAML

```yaml
# patterns/composed/full_review.yaml
name: full_review
type: scatter-gather
description: "Parallel multi-perspective review"
scatter:
  - pattern: code_review
  - pattern: security_review
  - pattern: architecture_review
gather:
  pattern: aggregate_reviews
```

---

## Pattern Discovery

```bash
# List all patterns
aios patterns list

# Filter by category
aios patterns list --category=review

# Search by keyword
aios patterns search "security compliance"

# Show pattern details (frontmatter + prompt preview)
aios patterns show security_review
```

### CLI Usage

```bash
# Simple invocation
cat spec.md | aios run extract_requirements

# With parameters
cat spec.md | aios run extract_requirements --standard=iec62443 --detail_level=high

# Pipe chain
cat spec.md | aios run extract_requirements | aios run identify_risks
```
