# Implementation Roadmap

> **Audience:** All

## Overview

AIOS is built incrementally in six phases. Each phase delivers immediately usable value.

```
Phase 1 ----> Phase 2 ----> Phase 3 ----> Phase 4 ----> Phase 5 ----> Phase 6
Foundation    Patterns      Personas      Workflows     Knowledge     Compliance
  DONE          DONE          DONE       MOSTLY DONE   MOSTLY DONE     OPEN
```

---

## Phase 1: Foundation -- DONE

**Goal:** CLI skeleton, provider abstraction, router, engine, tests.

- [x] Project structure (`src/`, `patterns/`, `docs/`, `personas/`)
- [x] CLI entry point (Commander.js + chalk)
- [x] `aios.yaml` with provider configuration
- [x] Provider abstraction (Claude API + Ollama)
- [x] `aios run <pattern>` with pipe input
- [x] Router (meta-agent: task to JSON execution plan)
- [x] `aios "natural language task"` with dynamic planning
- [x] `aios plan "task"` (plan only, do not execute)
- [x] DAG Engine (parallel execution with dependency resolution)
- [x] Saga Engine (retry and rollback)
- [x] 35 tests (vitest)

---

## Phase 2: Pattern Library -- DONE

**Goal:** Comprehensive pattern library with discovery, parameterization, and tool patterns.

- [x] Pattern specification format (YAML frontmatter + Markdown)
- [x] 36 patterns in 9 categories
- [x] Pattern discovery: `aios patterns list`, `aios patterns search <query>`
- [x] Pattern composition via pipes: `aios run p1 | aios run p2`
- [x] Pattern parameterization: `aios run review_code --language=python`
- [x] Custom pattern creator: `aios patterns create <name>`
- [x] Tool patterns (`mmdc`, `render-image`) -- patterns that invoke external CLI tools
- [x] Image generation via patterns (`render_image_nano` with Gemini image model)

---

## Phase 3: Personas -- DONE

**Goal:** Virtual team members with roles, runtime persona-pattern separation.

- [x] Persona specification format (YAML)
- [x] 8 personas (RE, Architect, Dev, Tester, Security, Reviewer, TechWriter, QM)
- [x] PersonaRegistry (load, list, select)
- [x] Persona + pattern separation at runtime
- [x] `aios ask <persona> "task"` works

---

## Phase 4: Workflows and Orchestration -- MOSTLY DONE

**Goal:** Defined workflows, EIP patterns, parallel execution, saga support.

### Done

- [x] DAG execution (parallel steps with dependency tracking)
- [x] Scatter-Gather for parallel agent execution
- [x] Retry on failure with escalation
- [x] Saga pattern with rollback/compensation
- [x] MCP server integration (external tool servers)
- [x] Dynamic MCP tool registration at runtime
- [x] Interactive chat REPL with slash commands

### Open

- [ ] Workflow definition format (YAML-based)
- [ ] `aios workflow run <name>` to start defined workflows
- [ ] Pub/Sub message bus (topic-based communication)
- [ ] Status tracking: `aios status` shows running workflows
- [ ] Workflow visualization (Mermaid output)

---

## Phase 5: Knowledge and Intelligence -- MOSTLY DONE

**Goal:** Shared knowledge, context management, semantic search, multi-provider intelligence.

### Done

- [x] Knowledge Base foundation (better-sqlite3)
- [x] CRUD operations (create, read, update, delete)
- [x] Text search over stored knowledge
- [x] Statistics (`aios knowledge stats`)
- [x] RAG with in-memory vector store
- [x] Local embeddings (Transformers.js) and Ollama embeddings
- [x] Configurable collections with preprocessing and search settings
- [x] Vision/OCR with cost-based provider selection
- [x] Gemini and OpenAI providers added (4 provider types total)

### Open

- [ ] Automatic knowledge import from agent outputs (extractor)
- [ ] Context injection: relevant knowledge automatically added to prompts
- [ ] Persona memory: agents remember project-specific decisions
- [ ] Cross-agent knowledge transfer

---

## Phase 6: Compliance and Team Operations -- OPEN

**Goal:** Full virtual development team for regulated environments.

See [compliance.md](compliance.md) for the detailed vision.

- [ ] Requirements-to-test traceability workflow
- [ ] Automatic test report generation
- [ ] Requirements coverage matrix
- [ ] Review protocols with audit trail
- [ ] Quality gates (automatic checks before release)
- [ ] Compliance reports (IEC 62443, EU CRA)
- [ ] `aios team "task"` -- delegate task to the full team
- [ ] Team dashboard (CLI-based, `aios status`)
- [ ] Integration with external tools (Git, Jira export, Azure DevOps export)
- [ ] Multi-project support
