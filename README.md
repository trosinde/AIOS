# AIOS -- AI Orchestration System

Describe what you want. AIOS plans and executes the workflow automatically -- with the right AI agents, in parallel where possible.

**Contents:** [Installation](#installation) | [Usage](#usage) | [Architecture](#architecture) | [Documentation](#documentation)

```bash
$ aios "Review this code for security and quality" < src/core/engine.ts

  Plan: scatter_gather (3 steps)
    review1 -> code_review     [|| reviews]
    review2 -> security_review [|| reviews]
    aggregate -> aggregate_reviews

  Parallel: review1 + review2
  review1 (3.4s)
  review2 (4.1s)
  aggregate (2.8s)

# CONSOLIDATED REVIEW
## Code Quality
  CRITICAL: No input validation in buildInput()...
## Security
  HIGH: execFile() without shell escaping (CWE-78)...
```

The **Router** (an LLM call) recognized that two reviews can run in parallel. The **Engine** executed them concurrently and consolidated the results. ~4 seconds instead of ~10.

(`aios` = `npx tsx src/cli.ts` throughout this document)

---

## Installation

### Quick Install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/trosinde/AIOS/main/install.sh | bash
```

The installer checks prerequisites, clones the repo, builds, and launches the interactive configuration wizard (`aios configure`).

### Manual Install

**Prerequisites:** Node.js 20+, npm, git, an LLM provider (Anthropic API key or local [Ollama](https://ollama.com))

```bash
git clone https://github.com/trosinde/AIOS.git && cd AIOS
npm install
aios configure                         # interactive setup wizard
# or manually:
export ANTHROPIC_API_KEY=sk-ant-...    # or skip if using Ollama
```

Verify: `aios patterns list` should show 35+ patterns.

For local LLMs (free): configure Ollama in `aios.yaml` and pass `--provider ollama`.

**Claude Code / OpenCode users:** Run `aios init` inside your project to generate `.aios/` with agent instructions, then your AI agent automatically knows how to use AIOS.

> **Full guide:** [docs/SETUP.md](docs/SETUP.md) | [docs/getting-started.md](docs/getting-started.md) | [docs/configuration.md](docs/configuration.md)

---

## Project Init (`aios init`)

Bootstrap any project for AIOS-assisted development. The wizard scans your project, asks a few questions, and generates a `.aios/` context folder that tells AI agents how to work with your project.

```bash
cd my-project
aios init                              # interactive wizard
aios init --quick                      # auto-detect everything, zero interaction
aios init --refresh                    # regenerate instructions from existing config
aios init --aios-path ~/tools/AIOS     # pre-set AIOS location
```

**What it creates:**

```
my-project/
├── CLAUDE.md                          ← patched with AIOS pointer (or created)
├── .aios/
│   ├── agent-instructions.md          ← generated instructions for AI agents
│   ├── context.yaml                   ← project configuration (commit this)
│   ├── .gitignore                     ← tracks config, ignores knowledge/
│   ├── patterns/                      ← project-local pattern overrides
│   └── knowledge/                     ← extracted knowledge (gitignored)
│       ├── decisions/
│       ├── requirements/
│       └── facts/
```

**Three zones, three owners:**

| Zone | Who writes | Who reads |
|------|-----------|-----------|
| `CLAUDE.md` | User | AI Agent |
| `.aios/*` | `aios init` | AI Agent + AIOS CLI |
| `~/tools/AIOS/*` | Only when working ON AIOS | AI Agent (read-only) |

**The wizard detects:**
- Language & frameworks (TypeScript, Python, Rust, Go, React, NestJS, Express, ...)
- Test framework (vitest, jest, pytest, cargo test, go test)
- CI/CD (GitHub Actions, GitLab CI, Jenkins)
- Compliance hints (IEC 62443, OWASP, CRA, GDPR, ...)
- Git remote, module system, source file count

**Read-only protection:** By default, the generated instructions tell AI agents that the AIOS directory is read-only — agents override patterns in `.aios/patterns/` instead of modifying AIOS itself.

**Re-init:** Running `aios init` again in a project with existing `.aios/` offers three choices: refresh (regenerate from config), reconfigure (re-run wizard), or abort.

---

## Usage

### Run a Single Pattern

Text in, prompt template applied, result out ([Fabric](https://github.com/danielmiessler/fabric)-style):

```bash
echo "Meeting notes..." | aios run summarize
cat app.ts | aios run code_review
cat spec.md | aios run extract_requirements --standard=iec62443
```

### Chain Patterns (Unix Pipes)

```bash
cat feature.txt | aios run extract_requirements | aios run generate_tests
```

### Automatic Workflows

Describe a task in natural language -- AIOS plans and executes the best workflow:

```bash
aios "Analyze this architecture and create a threat model" < design.md
aios "Implement OAuth2 with compliance check" --dry-run    # plan only
```

| You say | AIOS does |
|---------|-----------|
| "Summarize this" | 1 pattern, direct |
| "Review the code" | 2-3 reviews parallel, then consolidation |
| "Implement feature X" | Requirements -> Design -> Code + Tests parallel |
| "Feature with compliance" | Above + quality gates + rollback on failure |

### Interactive Chat

```bash
aios chat
```

Multi-turn conversation with context. Slash commands: `/<pattern>`, `/help`, `/patterns`, `/history`, `/clear`, `/exit`.

### All Commands

```bash
aios "task"                            # Automatic workflow
aios "task" --dry-run                  # Plan only
aios "task" --provider ollama          # Different provider

echo "text" | aios run <pattern>       # Single pattern
echo "text" | aios run <p> --key=val   # With parameters

aios init                              # Project context wizard
aios init --quick                      # Auto-detect, no questions
aios init --refresh                    # Regenerate from context.yaml
aios configure                         # Provider/API key setup

aios chat                              # Interactive REPL
aios plan "task"                       # Plan as JSON
aios patterns list                     # 35+ patterns
aios patterns search "security"        # Search
aios patterns show code_review         # Details + prompt
aios patterns create my_pattern        # New pattern (template)
```

### 35 Patterns in 9 Categories

| Category | Patterns |
|----------|----------|
| **analyze** | `extract_requirements`, `gap_analysis`, `identify_risks`, `threat_model` |
| **generate** | `generate_code`, `generate_tests`, `generate_docs`, `generate_adr`, `generate_diagram`, `design_solution`, `write_architecture_doc`, `write_user_doc`, `generate_image_prompt`, `render_image_nano` |
| **review** | `code_review`, `security_review`, `architecture_review`, `requirements_review`, `test_review` |
| **transform** | `summarize`, `refactor`, `translate_technical`, `simplify_text`, `formalize` |
| **report** | `aggregate_reviews`, `compliance_report`, `test_report`, `risk_report` |
| **pdf** | `pdf_vision_ocr` + MCP tools (`pdf_extract_text`, `pdf_thumbnails`, ...) |
| **rag** | `rag_search`, `rag_index` |
| **tool** | `render_diagram` (mmdc), `render_image` |
| **meta** | `evaluate_quality`, `extract_knowledge` |

### Key Features

**4 LLM Providers** with cost-based selection -- the engine automatically picks the cheapest available provider for each capability:

```
Ollama (free) -> Gemini Flash ($0.075/Mtok) -> GPT-4o-mini ($0.15) -> Claude Sonnet ($3.0)
```

**MCP Servers** -- external tools (PDF processing, Azure DevOps, etc.) auto-registered as patterns at startup.

**RAG** -- semantic search over custom data collections with local or Ollama embeddings.

**Vision/OCR** -- PDF pages analyzed as images via the cheapest vision-capable LLM provider.

**Image Generation** -- Generate images from text prompts via providers with `image_generation` capability (e.g. Gemini).

> **Full guide:** [docs/user-guide.md](docs/user-guide.md) | [docs/configuration.md](docs/configuration.md) | [docs/providers.md](docs/providers.md)

---

## Architecture

```
User: "Review code for security"
  |
  +- 1. Registry    loads patterns/*/system.md + MCP tools -> catalog
  +- 2. Router      LLM call: task + catalog -> JSON execution plan
  +- 3. Engine      executes plan: Promise.all, retry, rollback
       +- LLM steps      -> Provider (Claude / Ollama / Gemini / OpenAI)
       +- MCP steps      -> MCP servers (external tools)
       +- RAG steps      -> Vector store (semantic search)
       +- Vision steps   -> ProviderSelector (cheapest vision provider)
       +- Image steps    -> ProviderSelector (image_generation capability)
```

**Persona = WHO** (role, expertise) defined in `personas/*.yaml`
**Pattern = WHAT** (task, steps, output format) defined in `patterns/*/system.md`

At runtime: `system_prompt = persona.system_prompt + pattern.systemPrompt`

### Project Structure

```
src/
+-- cli.ts                       # CLI entry point (Commander.js)
+-- types.ts                     # All TypeScript interfaces
+-- core/
|   +-- registry.ts              # Pattern Registry -- loads system.md, builds catalog
|   +-- personas.ts              # Persona Registry -- loads YAML definitions
|   +-- router.ts                # Router -- LLM call that creates execution plans
|   +-- engine.ts                # Engine -- DAG execution, retry, saga, vision routing
|   +-- mcp.ts                   # MCP server management + tool registration
|   +-- repl.ts                  # Interactive chat session (REPL loop)
|   +-- slash.ts                 # Slash command parser (/command --key=value)
|   +-- knowledge.ts             # Knowledge Base (SQLite)
+-- agents/
|   +-- provider.ts              # LLM Provider interface + Claude/Ollama
|   +-- gemini-provider.ts       # Google Gemini REST provider
|   +-- openai-provider.ts       # OpenAI-compatible REST provider
|   +-- provider-selector.ts     # Cost-based provider selection by capability
+-- rag/
|   +-- rag-service.ts           # RAG service -- search, index, compare
|   +-- vector-store.ts          # In-memory vector store
|   +-- preprocessing.ts         # Chunking, cleaning, embedding
+-- init/
|   +-- scanner.ts              # Project scanner (language, frameworks, CI, compliance)
|   +-- schema.ts               # AiosContext Zod schema + parse/serialize
|   +-- wizard.ts               # Interactive wizard (--quick, --yes modes)
|   +-- generator.ts            # .aios/ directory tree generator
+-- commands/
|   +-- configure.ts            # Interactive setup wizard (aios configure)
+-- utils/
    +-- config.ts                # YAML config loader + .env management
    +-- stdin.ts                 # stdin helper

security/injection-patterns.yaml # Known injection patterns (YAML catalog)
patterns/*/system.md             # 35 patterns (YAML frontmatter + prompt)
personas/*.yaml                  # 8 personas (RE, Architect, Developer, Tester, ...)
```

### Workflow Types (Enterprise Integration Patterns)

| EIP Pattern | AIOS Realization |
|-------------|-----------------|
| Pipes and Filters | Unix pipes: `aios run p1 \| aios run p2` |
| Content-Based Router | Router analyzes task, selects patterns |
| Scatter-Gather | Parallel reviews + aggregation |
| Process Manager | DAG with topological sort |
| Saga | Retry -> escalation -> rollback (compensation) |
| Aggregator | `aggregate_reviews` pattern |
| Claim Check | Tool patterns: input -> temp file -> CLI tool -> output file |

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+, TypeScript (ESM, strict) |
| CLI | Commander.js + chalk |
| LLM | Anthropic SDK, Ollama REST, Gemini REST, OpenAI REST |
| MCP | @modelcontextprotocol/sdk |
| RAG | Transformers.js (local embeddings) + Ollama embeddings |
| Patterns | gray-matter (YAML frontmatter from Markdown) |
| Config | yaml + dotenv |
| Knowledge Base | better-sqlite3 |
| Tests | vitest (371 tests) |

> **Full guide:** [docs/architecture.md](docs/architecture.md) | [docs/workflows.md](docs/workflows.md) | [docs/patterns.md](docs/patterns.md) | [docs/personas.md](docs/personas.md)

---

## Documentation

All detailed documentation is in [`docs/`](docs/), written in English:

| Document | Audience | Content |
|----------|----------|---------|
| [Getting Started](docs/getting-started.md) | All | Installation, first commands, verification |
| [User Guide](docs/user-guide.md) | Users | CLI reference, patterns, chat, pipes, MCP, RAG, vision |
| [Configuration](docs/configuration.md) | Users + Ops | aios.yaml, providers, MCP, RAG, env vars, security |
| [Architecture](docs/architecture.md) | Developers | Components, data flow, dynamic orchestration |
| [Patterns](docs/patterns.md) | Developers | Frontmatter schema, catalog (35 patterns), composition |
| [Workflows](docs/workflows.md) | Developers | EIP patterns (Scatter-Gather, DAG, Saga) with timelines |
| [Personas](docs/personas.md) | Developers | 8 personas, team interaction, runtime separation |
| [Providers](docs/providers.md) | Developers | 4 LLM providers, cost-based selection, vision support |
| [MCP Servers](docs/MCP.md) | All | MCP server integration, PAT setup, security |
| [RAG](docs/rag.md) | Users + Dev | Semantic search, vector store, collections, embeddings |
| [Vision & Principles](docs/vision.md) | All | Project vision, solved problems, 7 principles |
| [Roadmap](docs/roadmap.md) | All | 6 phases -- what's done, what's open |
| [Compliance](docs/compliance.md) | Architects | Traceability, audit trail, quality gates (Phase 6 vision) |

---

## Security

AIOS implements Defense-in-Depth against Prompt Injection (OWASP LLM01):

- **Input Boundary Guard** – Unicode normalization, pattern detection, encoding detection, fuzzy matching
- **Data/Instruction Separation** – User input tagged as `<user_data>`, never mixed with system prompts
- **Plan-then-Execute** – Router plans without seeing raw user input; plan is frozen and immutable
- **Taint Tracking** – Every data value carries integrity/confidentiality labels (trusted/derived/untrusted)
- **Deterministic Policy Engine** – Blocks untrusted data from tool execution, KB writes, compliance artifacts
- **Knowledge Base Integrity** – Review queue for auto-extracted entries, provenance tracking
- **Audit Trail** – JSONL security event log for compliance (IEC 62443, EU CRA)

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full threat model and architecture.

---

## License

MIT
