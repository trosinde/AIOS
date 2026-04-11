# Knowledge Bus

The AIOS KnowledgeBus is a kernel-level persistent memory store backed by [LanceDB](https://github.com/lancedb/lancedb). It provides typed knowledge messages, hierarchical Wing/Room organization, semantic vector search via HNSW, knowledge-graph triples, diary entries, and duplicate detection — all in-process, all kernel-stable, no external Python services.

This document is the user- and integrator-facing reference for the KnowledgeBus.

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────┐
│  Patterns memory_recall / memory_store  (type: kb)      │
│  quality/pipeline consistency_check                     │
│  aios knowledge ... (CLI)                               │
└────────────────────────┬─────────────────────────────────┘
                         │  KernelMessage API (kernel-stable)
                         │  publish · query · search · byTrace · stats · delete
                         │  + semanticSearch · checkDuplicate · publishMany
                         │  + listTaxonomy · kgAdd · kgQuery · diaryWrite · diaryRead
                         ▼
┌──────────────────────────────────────────────────────────┐
│  src/core/knowledge-bus.ts                              │
│   - Wing/Room resolution via wing-resolver.ts           │
│   - Context isolation via WHERE source_context filter   │
│   - SHA-256 content_hash + cosine near-dup              │
│   - KCN (Knowledge Compact Notation) for recall output  │
└────────────┬──────────────────────┬──────────────────────┘
             │                      │
             ▼                      ▼
┌──────────────────────┐  ┌────────────────────────────────┐
│  LanceDB             │  │  EmbeddingProvider              │
│  ~/.aios/knowledge/  │  │  - OllamaEmbeddingProvider ★    │
│  ├── messages/       │  │    nomic-embed-text, 768 dim    │
│  │   (HNSW)          │  │  - StubEmbeddingProvider        │
│  └── kg_triples/     │  │    (deterministic, for tests)   │
└──────────────────────┘  └────────────────────────────────┘
```

★ default. Configurable via `aios.yaml` `knowledge.embedding_provider` block.

## Setup

The Knowledge Bus is built into AIOS — no separate install required. On first use it creates the storage directory at `~/.aios/knowledge/`.

For semantic search you need an embedding provider. The default is **Ollama** running locally with the `nomic-embed-text` model:

```bash
# One-time
ollama pull nomic-embed-text
```

Verify Ollama is reachable:

```bash
curl -s -X POST http://localhost:11434/api/embeddings \
  -d '{"model":"nomic-embed-text","prompt":"hello"}' | jq '.embedding | length'
# Expected: 768
```

If Ollama is not available, KB operations still work — `publish` writes the message with a zero-vector embedding so the workflow does not break, but `semanticSearch` results will be meaningless until you re-embed (`aios knowledge` will gain a `reembed` subcommand in a future release).

### Configuration

```yaml
# aios.yaml
knowledge:
  embedding_provider:
    type: ollama          # ollama | stub
    endpoint: http://localhost:11434
    model: nomic-embed-text
    dim: 768
  duplicate_threshold: 0.92  # cosine similarity for near-dup detection
```

## Concepts

### KernelMessage (the kernel-stable record)

Every item in the bus is a `KernelMessage` (defined in `src/types.ts`). Stable fields:

| Field | Purpose |
|---|---|
| `id` | UUID, set by the bus |
| `trace_id` | `ExecutionContext.trace_id` — ties the message to the workflow run that created it |
| `source_context` | `ContextConfig.name` of the publisher — first-class isolation key |
| `target_context` | `"*"` for broadcast or explicit recipient context name |
| `created_at` | Unix epoch ms |
| `type` | One of `decision \| fact \| requirement \| artifact \| finding \| pattern \| lesson \| diary` |
| `tags` | string[] for auxiliary tagging |
| `source_pattern` | The pattern name that emitted this message |
| `source_step` | Optional workflow step ID |
| `content` | The actual knowledge text |
| `format` | `text \| json \| markdown` |
| `metadata` | Free-form record for additional structured fields |
| `wing` | (additive) Hierarchical bucket — see Wing/Room below |
| `room` | (additive) Sub-topic within a wing |

### Wings & Rooms

Wings and Rooms are a two-level hierarchy. They let multiple contexts share the same abstract semantic categories (e.g. "decisions") while keeping their concrete buckets separate.

LLM patterns (`memory_recall`, `memory_store`) emit **semantic categories** like `decisions` or `findings`. The wing-resolver translates those into concrete wing names like `wing_aios_decisions` or `wing_myproject_adrs`, using the active `.aios/context.yaml` `memory.wings` block as the override map.

Default category → wing mapping (in `src/core/wing-resolver.ts`):

| Category | Default wing |
|---|---|
| `decisions` | `wing_aios_decisions` |
| `facts` | `wing_aios` |
| `findings` | `wing_aios_findings` |
| `patterns` | `wing_aios_patterns` |
| `lessons` | `wing_aios_patterns` (alias of patterns) |
| `compliance` | `wing_aios_compliance` |
| `default` | `wing_aios` |

Per-context override in `.aios/context.yaml`:

```yaml
schema_version: "1.0"
name: myproject
type: project

memory:
  wings:
    decisions: wing_myproject_adrs
    findings: wing_myproject_issues
    patterns: wing_myproject_practices
    compliance: wing_myproject_iec62443
    default: wing_myproject
```

The resolver walks up to 6 parent directories looking for `.aios/context.yaml`, so calls from sub-folders still find the project context.

Rooms are free-form snake_case strings chosen by the LLM at write time (e.g. `authentication`, `kernel_abi`, `mcp_integration`). They are not pre-mapped — the LLM picks them based on the topic.

### Knowledge Compact Notation (KCN)

KCN is the token-efficient text format used by `memory_recall` to inject context into the next workflow step. Every byte costs LLM input tokens, so the recall executor formats results as KCN rather than verbose JSON or Markdown.

Format:

```
[D|wing_aios_decisions|kernel_abi|abi,stable]
LanceDB chosen as KB backend because HNSW + columnar metadata
in single embedded process delivers in-process latency.
~~~
[F|wing_aios|embeddings]
nomic-embed-text emits 768-dim float32 vectors.
```

- One header line: `[<type>|<wing>|<room>|<tag>,<tag>]`
- Content body follows immediately
- Items separated by a `~~~` line
- Type abbreviations: D=decision, F=fact, R=requirement, A=artifact, P=pattern, L=lesson, X=finding, J=diary
- Trailing empty fields are dropped for compactness

KCN is ~60% cheaper than JSON for typical recall blocks (verified by `src/core/kcn.test.ts`). Encoder/decoder live in `src/core/kcn.ts`.

### Context isolation

Every query is scoped:

- **Default** (`include_cross_context: false`): only messages where `source_context == ctx.context_id`
- **With `include_cross_context: true`**: own context OR `target_context == "*"` OR `target_context == ctx.context_id`

Knowledge graph triples (`kgAdd` / `kgQuery`) are intentionally stricter — strict per-context only, no broadcast/targeting concept. Cross-context KG sharing is a Phase 3 follow-up if needed.

## API reference

All methods are async. Use `KnowledgeBus.create(dir, provider?)` to construct.

```ts
import { KnowledgeBus } from "./core/knowledge-bus.js";

const bus = await KnowledgeBus.create("~/.aios/knowledge");
```

### Read

| Method | Purpose |
|---|---|
| `query(filter, ctx)` | Filter by type, tags, source_pattern, since, with optional cross-context inclusion |
| `search(text, ctx, limit?)` | Substring search in content + tags |
| `semanticSearch(query, ctx, opts?)` | HNSW vector search; `opts: { top_k, type, wing, room }` |
| `byTrace(traceId)` | All messages from a single workflow run, chronologically |
| `stats(contextId?)` | Counts per type |
| `listTaxonomy(ctx)` | Wing/room/count tree for the active context |
| `kgQuery(pattern, ctx, limit?)` | Pattern-match `(subject?, predicate?, object?)` |
| `diaryRead(ctx, opts?)` | Diary entries chronologically |
| `checkDuplicate(content, ctx, threshold?)` | Two-stage hash + cosine dedup check |

### Write

| Method | Purpose |
|---|---|
| `publish(message, ctx)` | Insert one message with on-the-fly embedding |
| `publishMany(messages, ctx)` | Batch insert with batched embedding (~30× faster than sequential publishes) |
| `kgAdd(s, p, o, ctx, metadata?)` | Insert one triple |
| `diaryWrite(content, ctx, opts?)` | Append one diary entry |
| `delete(id)` | Delete one message |
| `ensureVectorIndex()` | Build/refresh the HNSW index after a bulk insert |

## CLI

```bash
# Write
echo "REST chosen over gRPC for client compatibility" | \
  aios knowledge publish --type decision --tags "api,rest"

echo "Today I tried the new pattern" | \
  aios knowledge diary-write --tags "experimental"

aios knowledge kg-add "AIOS" "uses" "LanceDB"

# Read — keyword
aios knowledge query --type decision
aios knowledge search "REST gRPC"

# Read — semantic
aios knowledge semantic-search "API protocol selection rationale" --top-k 5
aios knowledge semantic-search "vector storage" --wing wing_aios_decisions

# Read — structural
aios knowledge taxonomy
aios knowledge diary --limit 20
aios knowledge kg-query --subject AIOS
```

All commands take `--context <id>` for explicit context selection.

## Patterns: memory_recall and memory_store

Both patterns are declared as `type: kb` in their frontmatter. The Engine has a dedicated `executeKb` executor that:

1. Calls the LLM with the pattern's system prompt to extract structured intent (search queries for `recall`, memory items for `store`)
2. Parses the JSON output via the `extractFirstJsonObject` helper (robust against code-fencing and leading prose)
3. For **recall**: runs each query through `semanticSearch` in parallel, dedupes results by id, formats as KCN
4. For **store**: resolves each item's wing via `wing-resolver`, runs `checkDuplicate`, then `publish`

Neither pattern requires a tool subprocess — everything happens in-process via the long-lived KnowledgeBus instance attached to the Engine.

The Router (`patterns/_router/system.md`) plans these patterns automatically:

- Before main steps: `memory_recall` (when the task may benefit from prior knowledge)
- After main steps: `memory_store` (when the task produces durable knowledge)

Both are fire-and-forget at the engine level — embedding/KB failures fall back to a `_Kein Kontext verfügbar_` block instead of crashing the workflow.

## Performance

The KB is the performance-critical component because every quality-pipeline step issues several queries against it. Targets and verified numbers:

| Scenario | Target p95 | Verified (100k drawers, stub embedder) |
|---|---|---|
| `query` (filter) | < 20 ms | **5.7 ms** |
| `semanticSearch` (HNSW) | < 60 ms | **19.3 ms** |
| `publish` (warm) | < 100 ms | **6.7 ms** |
| `checkDuplicate` (cosine path) | < 80 ms | **36.1 ms** |
| 30 parallel `semanticSearch` | < 500 ms | **300 ms** |

With real Ollama embeddings (`nomic-embed-text`), `semanticSearch` adds ~14 ms per call (after the cold-start of the model loading, which is a one-time ~1.2 s on the first call).

### Benchmark scripts

| Script | Purpose | Duration |
|---|---|---|
| `npm run bench` | 10 vitest benchmarks with stub embedder, runs in CI | ~6 s |
| `npm run perf:kb:scale` | 100k seed + scale tests, dumps `results-*.json` | ~5 min |
| `npm run perf:kb:check` | Compare latest results vs `perf-baseline.json` | ~1 s |
| `tsx scripts/perf/kb-perf-scenarios.ts [scale]` | 8-Szenarien-Suite (recall@k, search_filter, concurrent_search, ingest+RSS, sequential vs batched, leak detection) | small=10 s, stress=10 min |

The scenario script can run with either the stub or real Ollama:

```bash
# Stub — fast smoke (recall@k will be random)
npx tsx scripts/perf/kb-perf-scenarios.ts small

# Real semantic recall (recall@5, recall@10)
EMBEDDING_PROVIDER=ollama npx tsx scripts/perf/kb-perf-scenarios.ts small
```

Verified with Ollama on a typical laptop: **recall@5 = 100% / recall@10 = 100%** at small scale (1000 drawers, 20 needles).

### Performance regression gate

`scripts/perf/compare-baseline.ts` compares the latest `results-*.json` against `perf-baseline.json` and fails if any metric exceeds 1.20× the baseline p95. Update the baseline only after a deliberate change:

```bash
npm run perf:kb:check                       # check
npm run perf:kb:check -- perf-baseline.json --update   # rebaseline
```

## Cost and limitations

- **LanceDB native binary**: ~50–80 MB per platform in `node_modules/@lancedb/lancedb`. Single embedded dependency, no external services.
- **HNSW build cost**: linear-ish in row count. 10k items: ~16 s. 100k items: ~4.5 min. One-time after a bulk seed; incremental writes after the index exists are fast.
- **LanceDB pre-1.0 (`0.27.x`)**: API may shift. We pin the exact version in `package.json` (no `^`) and have a contract test in `knowledge-bus.test.ts` covering every method we call.
- **No cross-encoder reranking**: phase 3 if quality of semantic search becomes a bottleneck.
- **No multi-user / sync**: lokal-only by design.
- **Embedding model choice is yours**: default is `nomic-embed-text` (768 dim, English+German competent). Switch via `aios.yaml`.

## Migration from older AIOS installs

The previous KB was a single-file `~/.aios/knowledge/bus.db` (better-sqlite3). New installs create `~/.aios/knowledge/` as a directory containing `messages/` and `kg_triples/` Lance tables. There is no automatic migration in this release because the embedding model is required for the new schema and we don't want to silently embed thousands of legacy rows. If you have old data, export it via the previous CLI and re-publish:

```bash
# Manual one-shot export from a backup of the old DB
sqlite3 bus.db.pre-lance "SELECT type, content, tags FROM messages" \
  | while IFS='|' read -r type content tags; do
      echo "$content" | aios knowledge publish --type "$type" --tags "$tags"
    done
```

A first-class `aios knowledge migrate-from-sqlite` command is on the roadmap if there's demand.
