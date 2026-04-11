> **Audience:** All users

# Getting Started with AIOS

AIOS is a CLI-based AI orchestration system that combines Fabric-style patterns with Enterprise Integration Patterns. Describe a task in natural language and AIOS decomposes it into parallel workflows automatically.

## Prerequisites

- **Node.js 20+** and **npm**
- An LLM provider: Anthropic API key **or** a local [Ollama](https://ollama.com) instance

## Installation

```bash
git clone <repo-url> aios
cd aios
npm install
```

Set your Anthropic API key (or skip this if using Ollama):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Verify Installation

```bash
npx tsx src/cli.ts patterns list
```

You should see 35+ patterns grouped by category (analysis, generation, review, etc.).

## First Run

**Run a single pattern** -- pipe text in, get results out:

```bash
echo "Kubernetes uses etcd for cluster state" | npx tsx src/cli.ts run summarize
```

**Automatic workflow** -- AIOS plans and executes multiple patterns:

```bash
npx tsx src/cli.ts "Review this code for security" < file.ts
```

Add `--dry-run` to see the execution plan without running it:

```bash
npx tsx src/cli.ts "Review this code for security" --dry-run < file.ts
```

**Interactive chat** -- REPL with slash commands:

```bash
npx tsx src/cli.ts chat
```

## Using Local LLMs (Ollama)

Configure an Ollama provider in `aios.yaml`:

```yaml
providers:
  ollama:
    type: ollama
    baseUrl: http://localhost:11434
    model: llama3
```

Then pass `--provider ollama` to any command:

```bash
echo "text" | npx tsx src/cli.ts run summarize --provider ollama
```

## Claude Code / Open Code Users

Clone AIOS as `.aios` inside your project directory. Slash commands from the pattern library become available directly in your coding session.

## Next Steps

- [User Guide](user-guide.md) -- full command reference and usage examples
- [Architecture](ARCHITECTURE.md) -- system internals and data flow
- [Patterns](PATTERNS.md) -- how patterns work and how to create them
