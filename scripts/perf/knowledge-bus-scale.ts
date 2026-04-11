#!/usr/bin/env tsx
/**
 * Knowledge Bus large-scale performance test (Phase 2).
 *
 * Seeds a fresh LanceDB with 100k synthetic drawers and runs the
 * key bench cases at this size. Output is a JSON results file
 * (`scripts/perf/results-<timestamp>.json`) plus a console summary.
 *
 * Use `npm run perf:kb:scale` to run. Takes ~2-3 minutes on a typical
 * laptop. Not part of `npm test` because it's too slow for every PR.
 *
 * Real-world numbers via Ollama (the default embedding provider) will
 * be slower than the stub-based bench results — Ollama adds 20-40 ms
 * per embedding call. This script uses the stub provider so the focus
 * is on LanceDB index/query characteristics, not the embedder.
 *
 * To run with Ollama instead, set EMBEDDING_PROVIDER=ollama in env.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { KnowledgeBus } from "../../src/core/knowledge-bus.js";
import {
  StubEmbeddingProvider,
  OllamaEmbeddingProvider,
  type EmbeddingProvider,
} from "../../src/core/embedding-provider.js";
import type { ExecutionContext, KnowledgeType } from "../../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCALE = parseInt(process.env.KB_SCALE ?? "100000", 10);
const PROVIDER = process.env.EMBEDDING_PROVIDER ?? "stub";

const POOL = [
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
  "Token-efficient KCN format saves recall context overhead",
  "Memory recall pattern uses LLM extraction of complementary semantic queries",
  "Cross-context broadcast supported via target_context wildcard",
  "Better-sqlite3 was the previous backend before LanceDB",
  "ExecutionContext stamps every message with trace_id and context_id",
];

interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

function makeProvider(): EmbeddingProvider {
  if (PROVIDER === "ollama") {
    return new OllamaEmbeddingProvider();
  }
  return new StubEmbeddingProvider();
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  return { result, ms };
}

function summarize(name: string, samples: number[]): BenchResult {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    name,
    iterations: samples.length,
    totalMs: sum,
    meanMs: sum / samples.length,
    p50Ms: pct(50),
    p95Ms: pct(95),
    p99Ms: pct(99),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

function formatRow(r: BenchResult): string {
  const pad = (s: string, w: number) => s.padEnd(w);
  const num = (n: number) => n.toFixed(2).padStart(8);
  return `${pad(r.name, 38)}  iter=${String(r.iterations).padStart(4)}  mean=${num(r.meanMs)}ms  p50=${num(r.p50Ms)}ms  p95=${num(r.p95Ms)}ms  p99=${num(r.p99Ms)}ms`;
}

async function main(): Promise<void> {
  console.error(`\n=== KnowledgeBus scale test ===`);
  console.error(`Scale: ${SCALE} drawers`);
  console.error(`Embedding provider: ${PROVIDER}\n`);

  const dir = mkdtempSync(join(tmpdir(), "aios-kb-scale-"));
  console.error(`DB dir: ${dir}`);

  const tCreate = process.hrtime.bigint();
  const bus = await KnowledgeBus.create(dir, makeProvider());
  console.error(`bus create: ${(Number(process.hrtime.bigint() - tCreate) / 1e6).toFixed(1)} ms`);

  const ctx: ExecutionContext = {
    trace_id: randomUUID(),
    context_id: "scale-ctx",
    started_at: Date.now(),
  };

  // ─── Seed phase ───────────────────────────────────────────
  console.error(`\nSeeding ${SCALE} drawers in chunks of 1000...`);
  const types: KnowledgeType[] = ["decision", "fact", "requirement", "artifact", "finding", "pattern"];
  const seedStart = process.hrtime.bigint();
  for (let chunk = 0; chunk < SCALE; chunk += 1000) {
    const size = Math.min(1000, SCALE - chunk);
    const messages = Array.from({ length: size }, (_, j) => {
      const i = chunk + j;
      return {
        type: types[i % types.length],
        tags: [`tag-${i % 8}`],
        source_pattern: `seed-${i % 5}`,
        content: `${POOL[i % POOL.length]} (#${i})`,
        format: "text" as const,
        target_context: ctx.context_id,
        wing: `wing-${i % 6}`,
        room: `room-${i % 12}`,
      };
    });
    await bus.publishMany(messages, ctx);
    if ((chunk + 1000) % 10000 === 0) {
      const elapsed = Number(process.hrtime.bigint() - seedStart) / 1e9;
      console.error(`  ${chunk + 1000}/${SCALE} (${elapsed.toFixed(1)}s)`);
    }
  }
  const seedMs = Number(process.hrtime.bigint() - seedStart) / 1e6;
  console.error(`Seed done in ${(seedMs / 1000).toFixed(1)}s (${(SCALE / (seedMs / 1000)).toFixed(0)} items/sec)\n`);

  // ─── Build vector index after bulk insert ─────────────────
  console.error(`Building HNSW vector index...`);
  const tIdx = process.hrtime.bigint();
  await bus.ensureVectorIndex();
  console.error(`Index ready: ${(Number(process.hrtime.bigint() - tIdx) / 1e6).toFixed(0)} ms\n`);

  const results: BenchResult[] = [];

  // ─── Bench 1: query-filter-large ──────────────────────────
  {
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const { ms } = await timed(() => bus.query({ type: "decision", limit: 20 }, ctx));
      samples.push(ms);
    }
    results.push(summarize("query-filter-large", samples));
  }

  // ─── Bench 2: semantic-search-large ───────────────────────
  {
    const samples: number[] = [];
    const queries = [
      "vector storage decision",
      "knowledge graph integration",
      "duplicate detection cosine",
      "wing room hierarchy",
      "embedding provider choice",
    ];
    for (let i = 0; i < 100; i++) {
      const { ms } = await timed(() =>
        bus.semanticSearch(queries[i % queries.length], ctx, { top_k: 10 }),
      );
      samples.push(ms);
    }
    results.push(summarize("semantic-search-large", samples));
  }

  // ─── Bench 3: publish-warm-at-scale ───────────────────────
  {
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const { ms } = await timed(() =>
        bus.publish(
          {
            type: "fact",
            tags: ["warm"],
            source_pattern: "scale-warm",
            content: `Hot insert at scale (#${i} ${randomUUID()})`,
            format: "text",
            target_context: ctx.context_id,
          },
          ctx,
        ),
      );
      samples.push(ms);
    }
    results.push(summarize("publish-warm-at-scale", samples));
  }

  // ─── Bench 4: concurrent-semantic-search-30-at-scale ──────
  {
    const samples: number[] = [];
    const queries = [
      "vector storage", "context isolation", "hnsw parameters",
      "duplicate detection", "wing hierarchy", "diary view",
      "knowledge graph", "ollama embedding", "lance schema", "memory recall",
    ];
    for (let i = 0; i < 30; i++) {
      const { ms } = await timed(async () => {
        const calls: Promise<unknown>[] = [];
        for (let j = 0; j < 30; j++) {
          calls.push(bus.semanticSearch(queries[j % queries.length], ctx, { top_k: 5 }));
        }
        await Promise.all(calls);
      });
      samples.push(ms);
    }
    results.push(summarize("concurrent-semantic-search-30-at-scale", samples));
  }

  // ─── Bench 5: checkDuplicate-at-scale ─────────────────────
  {
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const { ms } = await timed(() =>
        bus.checkDuplicate(`probe ${randomUUID()}`, ctx),
      );
      samples.push(ms);
    }
    results.push(summarize("checkDuplicate-at-scale", samples));
  }

  // ─── Output ───────────────────────────────────────────────
  console.error(`\n=== Results (${SCALE} drawers) ===\n`);
  for (const r of results) {
    console.error(formatRow(r));
  }

  const outDir = join(__dirname);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(outDir, `results-${stamp}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        scale: SCALE,
        provider: PROVIDER,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        results,
      },
      null,
      2,
    ),
  );
  console.error(`\nWritten: ${outFile}`);
}

main().catch((e) => {
  console.error(`FAIL: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
