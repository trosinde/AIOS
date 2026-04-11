/**
 * KnowledgeBus performance benchmarks (Phase 1).
 *
 * Run with `npm run bench`. Vitest's bench runner records iter/sec
 * and statistical distribution (mean/median/p99) per case.
 *
 * The benchmarks here use the **stub** embedding provider so results
 * are deterministic and CI-stable. The stub mimics the *shape* of an
 * embedding call (Float32Array of `dim=768`) but skips the actual
 * model invocation. Real-world numbers will be slower because Ollama
 * embedding adds 20-40 ms per call. For end-to-end numbers including
 * Ollama see `scripts/perf/knowledge-bus-scale.ts`.
 *
 * Note on structure: Vitest 2.x benches do NOT honor describe-level
 * `beforeAll` hooks (the bench runner runs in a separate phase). To
 * share expensive setup (like seeding a 10k-row table) across bench
 * iterations, we use lazy module-level singleton promises that
 * initialize on first access and reuse the result for every iteration.
 *
 * Performance budgets are checked in CI by
 * `scripts/perf/compare-baseline.ts` against `perf-baseline.json`.
 */
import { describe, bench } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { KnowledgeBus } from "./knowledge-bus.js";
import { StubEmbeddingProvider } from "./embedding-provider.js";
import type { ExecutionContext, KnowledgeType } from "../types.js";

const BENCH_CONTENT_POOL = [
  "Use LanceDB for vector storage in the kernel knowledge bus",
  "Quality pipeline runs consistency checks against decisions and facts",
  "Wing/room hierarchy decouples semantic categories from concrete buckets",
  "Embedding provider abstraction allows Ollama, transformers.js, or stub backends",
  "Context isolation enforced via WHERE source_context filter on every query",
  "HNSW index built lazily after 256 rows to avoid premature optimization",
  "Persistent vector index survives process restarts without rebuild",
  "Knowledge graph triples live in separate kg_triples LanceDB table",
  "Diary entries are messages with type='diary' for chronological views",
  "Duplicate detection two-stage: content_hash exact then cosine near-dup",
];

function makeContent(i: number): string {
  return `${BENCH_CONTENT_POOL[i % BENCH_CONTENT_POOL.length]} (#${i})`;
}

function makeCtx(): ExecutionContext {
  return { trace_id: randomUUID(), context_id: "bench-ctx", started_at: Date.now() };
}

async function makeBus(): Promise<KnowledgeBus> {
  const dir = mkdtempSync(join(tmpdir(), "aios-kb-bench-"));
  return KnowledgeBus.create(dir, new StubEmbeddingProvider());
}

async function seedBus(bus: KnowledgeBus, ctx: ExecutionContext, count: number): Promise<void> {
  const types: KnowledgeType[] = ["decision", "fact", "requirement", "artifact"];
  // Insert in chunks of 1000 — single 10k LanceDB add is fine but
  // chunking gives more graceful memory behavior on the larger sizes.
  for (let chunk = 0; chunk < count; chunk += 1000) {
    const size = Math.min(1000, count - chunk);
    const messages = Array.from({ length: size }, (_, j) => {
      const i = chunk + j;
      return {
        type: types[i % types.length],
        tags: [`tag-${i % 5}`],
        source_pattern: `bench-${i % 3}`,
        content: makeContent(i),
        format: "text" as const,
        target_context: ctx.context_id,
        wing: `wing-${i % 4}`,
        room: `room-${i % 7}`,
      };
    });
    await bus.publishMany(messages, ctx);
  }
}

// ─── Lazy singleton fixtures ───────────────────────────────────
//
// Each fixture is built once on first access and reused across every
// subsequent bench iteration. This is the only way to amortize a
// 10k-row seed across 50 measured iterations under vitest 2.x bench
// mode (no beforeAll support for bench()).

interface Fixture {
  bus: KnowledgeBus;
  ctx: ExecutionContext;
}

let warmFixturePromise: Promise<Fixture> | null = null;
function warmFixture(): Promise<Fixture> {
  if (!warmFixturePromise) {
    warmFixturePromise = (async () => {
      const bus = await makeBus();
      return { bus, ctx: makeCtx() };
    })();
  }
  return warmFixturePromise;
}

let small1kPromise: Promise<Fixture> | null = null;
function small1kFixture(): Promise<Fixture> {
  if (!small1kPromise) {
    small1kPromise = (async () => {
      const bus = await makeBus();
      const ctx = makeCtx();
      await seedBus(bus, ctx, 1000);
      return { bus, ctx };
    })();
  }
  return small1kPromise;
}

let medium10kPromise: Promise<Fixture> | null = null;
function medium10kFixture(): Promise<Fixture> {
  if (!medium10kPromise) {
    medium10kPromise = (async () => {
      const bus = await makeBus();
      const ctx = makeCtx();
      await seedBus(bus, ctx, 10000);
      return { bus, ctx };
    })();
  }
  return medium10kPromise;
}

let dupHitPromise: Promise<Fixture & { content: string }> | null = null;
function dupHitFixture(): Promise<Fixture & { content: string }> {
  if (!dupHitPromise) {
    dupHitPromise = (async () => {
      const bus = await makeBus();
      const ctx = makeCtx();
      const content = "well known duplicate content for hash hit benchmark";
      await bus.publish(
        {
          type: "fact",
          tags: [],
          source_pattern: "dup",
          content,
          format: "text",
          target_context: ctx.context_id,
        },
        ctx,
      );
      return { bus, ctx, content };
    })();
  }
  return dupHitPromise;
}

// ─── 1. publish-cold ──────────────────────────────────────────

describe("publish-cold", () => {
  bench(
    "first publish on a freshly opened KB",
    async () => {
      const bus = await makeBus();
      const ctx = makeCtx();
      await bus.publish(
        {
          type: "fact",
          tags: [],
          source_pattern: "cold",
          content: "cold publish content",
          format: "text",
          target_context: ctx.context_id,
        },
        ctx,
      );
    },
    { iterations: 30, warmupIterations: 3 },
  );
});

// ─── 2. publish-warm ──────────────────────────────────────────

let warmCounter = 0;
describe("publish-warm", () => {
  bench(
    "sequential publish on a warm KB",
    async () => {
      const f = await warmFixture();
      await f.bus.publish(
        {
          type: "fact",
          tags: [`t-${warmCounter}`],
          source_pattern: "warm",
          content: makeContent(warmCounter++),
          format: "text",
          target_context: f.ctx.context_id,
        },
        f.ctx,
      );
    },
    { iterations: 100, warmupIterations: 10 },
  );
});

// ─── 3. publish-batch-100 ─────────────────────────────────────

describe("publish-batch-100", () => {
  bench(
    "publishMany batch of 100 items",
    async () => {
      const f = await warmFixture();
      const batch = Array.from({ length: 100 }, (_, i) => ({
        type: "fact" as KnowledgeType,
        tags: [],
        source_pattern: "batch",
        content: makeContent(i + Date.now()),
        format: "text" as const,
        target_context: f.ctx.context_id,
      }));
      await f.bus.publishMany(batch, f.ctx);
    },
    { iterations: 20, warmupIterations: 2 },
  );
});

// ─── 4. query-filter-small (1k items) ─────────────────────────

describe("query-filter-small", () => {
  bench(
    "filter query against 1k drawers",
    async () => {
      const f = await small1kFixture();
      await f.bus.query({ type: "decision", limit: 20 }, f.ctx);
    },
    { iterations: 100, warmupIterations: 10 },
  );
});

// ─── 5. query-filter-medium (10k items) ───────────────────────

describe("query-filter-medium", () => {
  bench(
    "filter query against 10k drawers",
    async () => {
      const f = await medium10kFixture();
      await f.bus.query({ type: "decision", limit: 20 }, f.ctx);
    },
    { iterations: 50, warmupIterations: 5 },
  );
});

// ─── 6. semantic-search-small (1k items) ──────────────────────

describe("semantic-search-small", () => {
  bench(
    "semanticSearch top-10 against 1k drawers",
    async () => {
      const f = await small1kFixture();
      await f.bus.semanticSearch("vector storage decision", f.ctx, { top_k: 10 });
    },
    { iterations: 100, warmupIterations: 10 },
  );
});

// ─── 7. semantic-search-medium (10k items) ────────────────────

describe("semantic-search-medium", () => {
  bench(
    "semanticSearch top-10 against 10k drawers",
    async () => {
      const f = await medium10kFixture();
      await f.bus.semanticSearch("knowledge graph integration", f.ctx, { top_k: 10 });
    },
    { iterations: 50, warmupIterations: 5 },
  );
});

// ─── 8. checkDuplicate-hit (exact match) ──────────────────────

describe("checkDuplicate-hit", () => {
  bench(
    "checkDuplicate exact-hash hit",
    async () => {
      const f = await dupHitFixture();
      await f.bus.checkDuplicate(f.content, f.ctx);
    },
    { iterations: 100, warmupIterations: 10 },
  );
});

// ─── 9. checkDuplicate-near (cosine path) ─────────────────────

describe("checkDuplicate-near", () => {
  bench(
    "checkDuplicate cosine path against 1k drawers",
    async () => {
      const f = await small1kFixture();
      await f.bus.checkDuplicate(`unique probe ${randomUUID()}`, f.ctx);
    },
    { iterations: 50, warmupIterations: 5 },
  );
});

// ─── 10. concurrent-semanticSearch-30 ─────────────────────────

describe("concurrent-semanticSearch-30", () => {
  bench(
    "30 parallel semanticSearch calls (quality-pipeline simulation)",
    async () => {
      const f = await small1kFixture();
      const queries = [
        "vector storage choice",
        "context isolation rules",
        "hnsw index parameters",
        "duplicate detection algorithm",
        "wing room hierarchy",
        "diary chronological view",
        "knowledge graph triples",
        "ollama embedding latency",
        "lance db schema",
        "memory recall pattern",
      ];
      const calls: Promise<unknown>[] = [];
      for (let i = 0; i < 30; i++) {
        calls.push(f.bus.semanticSearch(queries[i % queries.length], f.ctx, { top_k: 5 }));
      }
      await Promise.all(calls);
    },
    { iterations: 20, warmupIterations: 3 },
  );
});
