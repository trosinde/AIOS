# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev -- <args>        # Run CLI via tsx (no build needed): tsx src/cli.ts <args>
npm run build                # Compile TypeScript → dist/
npm run start -- <args>      # Run compiled: node dist/cli.js <args>
npm run typecheck            # Type-check without emitting (tsc --noEmit)
npm test                     # Run all tests: vitest run
npx vitest run src/core/engine.test.ts          # Single test file
npx vitest run -t "test name pattern"           # Single test by name
```

## What is AIOS?

CLI-basiertes AI-Orchestrierungssystem. Fabric-Style Patterns + Enterprise Integration Patterns. Natürlichsprachliche Aufgaben werden dynamisch in parallele Workflows zerlegt.

## Architecture (3 Layers)

```
User Input → [Router/Meta-Agent] → Execution Plan (JSON) → [DAG Engine] → Output
```

- **Pattern Registry** (`core/registry.ts`): Loads `patterns/*/system.md` files. Each pattern = Markdown with YAML frontmatter (metadata in `PatternMeta`) + system prompt. New pattern = new Markdown file.
- **Router** (`core/router.ts`): An LLM call itself. Takes task + pattern catalog → returns JSON `ExecutionPlan`. Parses JSON from fenced or raw LLM output.
- **Engine** (`core/engine.ts`): Mechanical DAG execution. Topological sort, `Promise.all` for parallel steps, retry/rollback on failure. Supports both LLM patterns and tool patterns (CLI tool invocation).

### Key Data Flow

1. `cli.ts` parses commands via Commander.js → creates `PatternRegistry`, `LLMProvider`, `Router`, `Engine`
2. Router's `planWorkflow()` sends task + pattern catalog to LLM → gets back `ExecutionPlan` (defined in `types.ts`)
3. Engine's `execute()` runs steps respecting `depends_on` DAG, collecting `StepResult` per step
4. Steps reference patterns by name; input comes from `$USER_INPUT` or other step IDs via `input_from`

### Provider Abstraction

`agents/provider.ts` defines the `LLMProvider` interface with `complete()` and `chat()` methods. Two implementations: `ClaudeProvider` (Anthropic SDK) and `OllamaProvider` (REST). Factory function `createProvider()` creates the right one from config.

### Execution Plan Types

Plans have a `type` field: `pipe`, `scatter_gather`, `dag`, or `saga`. Steps can have `retry`, `quality_gate`, and `compensate` (saga rollback) configuration.

## Development Guidelines

- TypeScript strict mode, ESM modules (`"type": "module"` in package.json)
- All I/O async/await
- Prefer functions over classes, but use Interfaces for all data structures (`types.ts`)
- Pattern files are read at runtime, never bundled
- Logging on stderr, results on stdout (Unix convention)
- Tests colocated with source: `src/core/engine.test.ts` next to `src/core/engine.ts`

## CLI Commands

```bash
aios "Natürlichsprachliche Aufgabe"      # Router plans dynamically
aios run <pattern> [< input]             # Run single pattern (Fabric-Style)
aios plan "Aufgabe"                      # Plan only, don't execute
aios chat [--provider <name>]            # Interactive REPL with slash commands
aios patterns list                       # List all patterns
aios patterns show <name>               # Show pattern details
```

## Documentation

Detailed docs in `docs/`: VISION.md, ARCHITECTURE.md, PATTERNS.md, WORKFLOWS.md, PERSONAS.md, PHASES.md, REGULATED.md. Reference implementations in `docs/reference/`.
