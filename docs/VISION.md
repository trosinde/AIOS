# AIOS -- Vision and Principles

> **Audience:** All

## Vision

AIOS is a CLI-based AI orchestration system that unites independent AI agents into a collaborative virtual team. It draws inspiration from three sources:

- **Fabric** (Daniel Miessler) -- Reusable patterns as a tool library
- **Enterprise Integration Patterns** (Gregor Hohpe / Bobby Woolf) -- Asynchronous, event-based communication between agents
- **Agile Software Development** -- Roles, artifacts, and workflows adapted for regulated environments

## Core Problems Solved

| Problem | Solution | Status |
|---------|----------|--------|
| Agents work in isolation, no knowledge transfer | Shared Knowledge Base (SQLite + Vector Store) | DONE |
| Manual switching between CLI tools | Unified CLI as Router/Orchestrator | DONE |
| Inconsistencies from manual data transfer | Single Source of Truth + Pattern Registry | DONE |
| No dynamic workflow composition | Pattern-based pipelines with EIP routing | DONE |
| Sequential instead of parallel work | DAG Engine with topological execution | DONE |
| No external tool integration | MCP Server support with dynamic registration | DONE |
| Single LLM vendor lock-in | 4 provider types with cost-based selection | DONE |
| No semantic search over project data | RAG with vector store and configurable collections | DONE |
| No visual document analysis | Vision/OCR with provider selection | DONE |
| No AI-driven image generation | Image generation with capability-based provider selection | DONE |

## System Overview

```
+-------------------------------------------------------------+
|                        AIOS CLI                              |
|                   (Unified Entry Point)                      |
+-------------------------------------------------------------+
|                                                              |
|  +------------+  +------------+  +------------+              |
|  |  Pattern   |  |   Router   |  |    DAG     |              |
|  |  Registry  |  | (Meta-Ag.) |  |   Engine   |              |
|  +------+-----+  +------+-----+  +------+-----+              |
|         |               |               |                    |
|         +---------------+---------------+                    |
|                         |                                    |
|  +----------+ +----------+ +----------+ +----------+         |
|  | Anthropic| |  Ollama  | |  Gemini  | |  OpenAI  |         |
|  | Provider | | Provider | | Provider | | Provider |         |
|  +----------+ +----------+ +----------+ +----------+         |
|                                                              |
|  +---------------------------+  +------------------------+   |
|  |   MCP Server Integration  |  |  RAG / Vector Store    |   |
|  |   (dynamic tool loading)  |  |  (search + indexing)   |   |
|  +---------------------------+  +------------------------+   |
|                                                              |
|  +--------------------------------------------------------+  |
|  |          Shared Knowledge Base (SQLite)                 |  |
|  +--------------------------------------------------------+  |
+-------------------------------------------------------------+
```

## Documentation Index

| File | Audience | Description |
|------|----------|-------------|
| [getting-started.md](getting-started.md) | All | Quick start, installation, first commands |
| [user-guide.md](user-guide.md) | Users | CLI usage, patterns, chat, pipes, MCP, RAG, Vision |
| [configuration.md](configuration.md) | Users + Ops | aios.yaml, providers, MCP, RAG, env vars |
| [architecture.md](architecture.md) | Developers | Components, data flow, dynamic orchestration |
| [patterns.md](patterns.md) | Developers | Frontmatter schema, catalog (35 patterns) |
| [workflows.md](workflows.md) | Developers | EIP patterns (Scatter-Gather, DAG, Saga) |
| [personas.md](personas.md) | Developers | 8 personas, team interaction |
| [providers.md](providers.md) | Developers | 4 LLM providers, cost-based selection, vision |
| [MCP.md](MCP.md) | All | MCP server integration, PAT setup |
| [rag.md](rag.md) | Users + Dev | Semantic search, vector store, embeddings |
| [vision.md](vision.md) | All | This document -- project vision and principles |
| [roadmap.md](roadmap.md) | All | 6 implementation phases and current status |
| [compliance.md](compliance.md) | Architects | Traceability, quality gates (Phase 6 vision) |

## Principles

1. **CLI-First** -- Everything is controllable from the command line.
2. **Composable** -- Small, reusable units following the Unix philosophy.
3. **Event-Driven** -- Agents communicate asynchronously via events.
4. **Provider-Agnostic** -- Claude, Ollama, Gemini, and OpenAI as interchangeable backends.
5. **Knowledge-Centric** -- Shared knowledge is a first-class citizen.
6. **Traceable** -- Every decision and artifact is auditable.
7. **Incremental** -- Built step by step, usable immediately at each stage.
