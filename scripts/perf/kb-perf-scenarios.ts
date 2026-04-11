#!/usr/bin/env tsx
/**
 * KnowledgeBus performance scenarios — full-spectrum benchmarks.
 *
 * Covers eight scenarios that together characterize the KB under
 * realistic AIOS workload:
 *   1. ingest               — bulk publishMany throughput + RSS sampling
 *   2. index build          — HNSW one-time cost as a function of N
 *   3. search latency       — semantic search latency distribution
 *   4. search_recall        — recall@5 / recall@10 via planted needles
 *   5. search_filter        — wing-filtered vs unfiltered semantic search
 *   6. concurrent_search    — 4-worker parallel semanticSearch
 *   7. chromadb_insert      — sequential publish vs publishMany speedup
 *   8. memory_search        — RSS leak detection over many search calls
 *
 * Scale matrix:
 *   small  =     1_000 drawers (CI smoke)
 *   medium =    10_000 drawers
 *   large  =    50_000 drawers
 *   stress =   100_000 drawers
 *
 * Run with `tsx scripts/perf/kb-perf-scenarios.ts [scale]`
 * Default scale = small. Embeddings via stub by default; set
 * EMBEDDING_PROVIDER=ollama for real semantic recall numbers.
 *
 * Output: `scripts/perf/kb-scenarios-<scale>-<timestamp>.json` plus
 * console summary.
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

// ─── Scale matrix ──────────────────────────────────────────

interface ScaleConfig {
  drawers: number;
  wings: number;
  rooms_per_wing: number;
  needles: number;
  search_queries: number;
}

const SCALE_CONFIGS: Record<string, ScaleConfig> = {
  small:  { drawers: 1_000,  wings: 3,  rooms_per_wing: 5,  needles: 20,  search_queries: 20  },
  medium: { drawers: 10_000, wings: 8,  rooms_per_wing: 12, needles: 50,  search_queries: 50  },
  large:  { drawers: 50_000, wings: 15, rooms_per_wing: 20, needles: 100, search_queries: 100 },
  stress: { drawers: 100_000, wings: 25, rooms_per_wing: 30, needles: 200, search_queries: 200 },
};

const SCALE_NAME = process.argv[2] ?? process.env.BENCH_SCALE ?? "small";
const CFG = SCALE_CONFIGS[SCALE_NAME];
if (!CFG) {
  console.error(`Unknown scale "${SCALE_NAME}". Pick: ${Object.keys(SCALE_CONFIGS).join(", ")}`);
  process.exit(1);
}

const PROVIDER_NAME = process.env.EMBEDDING_PROVIDER ?? "stub";

// ─── Needle definitions for recall@k measurement ───────────

const NEEDLE_TOPICS = [
  "PostgreSQL VACUUM strategy",
  "Redis sentinel failover behavior",
  "Kubernetes HPA target utilization",
  "JWT key rotation procedure",
  "TLS certificate renewal automation",
  "OAuth2 PKCE flow specifics",
  "Kafka consumer rebalance protocol",
  "Elasticsearch shard allocation rules",
  "MongoDB writeConcern guarantees",
  "MySQL InnoDB undo log purge",
  "Nginx upstream keepalive tuning",
  "HAProxy health check interval",
  "Envoy filter chain ordering",
  "Istio mTLS strict mode",
  "Cilium network policy enforcement",
  "Prometheus remote write throughput",
  "Grafana dashboard provisioning",
  "Loki retention configuration",
  "Tempo trace search latency",
  "Mimir block storage layout",
];

interface BenchResult {
  category: string;
  metric: string;
  value: number;
  unit?: string;
}

// ─── Deterministic PRNG (mulberry32) ────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ─── Data generator ─────────────────────────────────────────

function generateContent(i: number, isNeedle: boolean): string {
  if (isNeedle) {
    const topic = NEEDLE_TOPICS[i % NEEDLE_TOPICS.length];
    return `NEEDLE_${String(i).padStart(4, "0")}: detailed knowledge about ${topic}`;
  }
  const filler = [
    "general system observation about runtime behavior",
    "configuration recommendation noted during review",
    "follow-up action item from quality gate",
    "benchmark result snapshot for reference",
    "compliance check passed for module",
    "refactoring opportunity identified in codebase",
  ];
  return `${pick(filler)} (entry #${i})`;
}

interface SeedItem {
  type: KnowledgeType;
  tags: string[];
  source_pattern: string;
  content: string;
  format: "text";
  target_context: string;
  wing: string;
  room: string;
}

function generateSeed(cfg: ScaleConfig, ctxId: string): {
  items: SeedItem[];
  needleAnswers: Map<string, string>; // query topic → exact content (for recall lookup)
} {
  const items: SeedItem[] = [];
  const needleAnswers = new Map<string, string>();
  const types: KnowledgeType[] = ["decision", "fact", "requirement", "artifact", "finding", "pattern"];

  // 1. Plant needles at deterministic positions
  for (let n = 0; n < cfg.needles; n++) {
    const topic = NEEDLE_TOPICS[n % NEEDLE_TOPICS.length];
    const content = generateContent(n, true);
    needleAnswers.set(topic, content);
  }

  // 2. Build the full set, mixing needles and filler
  for (let i = 0; i < cfg.drawers; i++) {
    const isNeedle = i < cfg.needles;
    const wing = `wing-${i % cfg.wings}`;
    const room = `room-${i % cfg.rooms_per_wing}`;
    items.push({
      type: types[i % types.length],
      tags: [`tag-${i % 8}`],
      source_pattern: "seed",
      content: generateContent(i, isNeedle),
      format: "text" as const,
      target_context: ctxId,
      wing,
      room,
    });
  }

  return { items, needleAnswers };
}

// ─── Provider factory ──────────────────────────────────────

function makeProvider(): EmbeddingProvider {
  if (PROVIDER_NAME === "ollama") {
    return new OllamaEmbeddingProvider();
  }
  return new StubEmbeddingProvider();
}

// ─── Helpers ───────────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  return { result, ms };
}

function pct(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function avg(samples: number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

// ─── RSS sampler — runs in the background during ingest ───

class RssSampler {
  private samples: number[] = [];
  private timer: NodeJS.Timeout | null = null;

  start(intervalMs: number = 100): void {
    this.samples = [];
    this.timer = setInterval(() => {
      this.samples.push(process.memoryUsage().rss);
    }, intervalMs);
  }

  stop(): { peakMb: number; avgMb: number; deltaMb: number } {
    if (this.timer) clearInterval(this.timer);
    if (this.samples.length === 0) {
      return { peakMb: 0, avgMb: 0, deltaMb: 0 };
    }
    const peakBytes = Math.max(...this.samples);
    const avgBytes = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const deltaBytes = this.samples[this.samples.length - 1] - this.samples[0];
    return {
      peakMb: peakBytes / 1024 / 1024,
      avgMb: avgBytes / 1024 / 1024,
      deltaMb: deltaBytes / 1024 / 1024,
    };
  }
}

// ─── Bench scenarios ──────────────────────────────────────

async function main(): Promise<void> {
  console.error(`\n=== KnowledgeBus performance scenarios ===`);
  console.error(`Scale: ${SCALE_NAME} (${CFG.drawers} drawers, ${CFG.needles} needles, ${CFG.wings} wings)`);
  console.error(`Embedding provider: ${PROVIDER_NAME}`);
  if (PROVIDER_NAME === "stub") {
    console.error(`NOTE: stub embeddings produce essentially random recall@k.`);
    console.error(`      For meaningful semantic numbers, set EMBEDDING_PROVIDER=ollama.`);
  }
  console.error("");

  const dir = mkdtempSync(join(tmpdir(), "aios-mp-parity-"));
  const bus = await KnowledgeBus.create(dir, makeProvider());
  const ctx: ExecutionContext = {
    trace_id: randomUUID(),
    context_id: "parity-ctx",
    started_at: Date.now(),
  };

  const results: BenchResult[] = [];
  const record = (category: string, metric: string, value: number, unit?: string) => {
    results.push({ category, metric, value, unit });
  };

  // ─── 1. ingest (with RSS sampling) ────────────────────────
  console.error(`[1/8] ingest @ ${CFG.drawers}`);
  const { items, needleAnswers } = generateSeed(CFG, ctx.context_id);
  const rss = new RssSampler();
  rss.start(50);
  const ingestStart = process.hrtime.bigint();
  for (let chunk = 0; chunk < items.length; chunk += 1000) {
    const batch = items.slice(chunk, chunk + 1000);
    await bus.publishMany(batch, ctx);
  }
  const ingestMs = Number(process.hrtime.bigint() - ingestStart) / 1e6;
  const rssStats = rss.stop();
  record("ingest", `drawers_per_sec_at_${CFG.drawers}`, (CFG.drawers * 1000) / ingestMs);
  record("ingest", `elapsed_sec_at_${CFG.drawers}`, ingestMs / 1000);
  record("ingest", "peak_rss_mb", rssStats.peakMb);
  record("ingest", "rss_delta_mb", rssStats.deltaMb);
  console.error(`      ${(CFG.drawers / (ingestMs / 1000)).toFixed(0)} drawers/sec  peak_rss=${rssStats.peakMb.toFixed(0)}MB`);

  // ─── 2. Build vector index (one-time post-ingest cost) ───
  console.error(`[2/8] HNSW index build`);
  const idxStart = process.hrtime.bigint();
  await bus.ensureVectorIndex();
  const idxMs = Number(process.hrtime.bigint() - idxStart) / 1e6;
  record("index", `build_elapsed_sec_at_${CFG.drawers}`, idxMs / 1000);
  console.error(`      ${(idxMs / 1000).toFixed(1)}s`);

  // ─── 3. search latency sweep ──────────────────────────────
  console.error(`[3/8] search latency`);
  const queries = Array.from({ length: CFG.search_queries }, (_, i) =>
    NEEDLE_TOPICS[i % NEEDLE_TOPICS.length],
  );
  const searchSamples: number[] = [];
  for (const q of queries) {
    const { ms } = await timed(() => bus.semanticSearch(q, ctx, { top_k: 10 }));
    searchSamples.push(ms);
  }
  record("search", `avg_latency_ms_at_${CFG.drawers}`, avg(searchSamples));
  record("search", `p50_ms_at_${CFG.drawers}`, pct(searchSamples, 50));
  record("search", `p95_ms_at_${CFG.drawers}`, pct(searchSamples, 95));
  console.error(`      avg=${avg(searchSamples).toFixed(2)}ms  p50=${pct(searchSamples, 50).toFixed(2)}ms  p95=${pct(searchSamples, 95).toFixed(2)}ms`);

  // ─── 4. search recall (needle hit rate) ───────────────────
  // For each needle topic, query "PostgreSQL VACUUM strategy" and check
  // whether the planted "NEEDLE_xxxx: ... PostgreSQL VACUUM strategy" content
  // appears in top-5 / top-10. Pure semantic test — no LLM judge.
  console.error(`[4/8] search_recall (recall@k)`);
  let hits5 = 0;
  let hits10 = 0;
  let totalNeedles = 0;
  for (const [topic, expectedContent] of needleAnswers) {
    const top10 = await bus.semanticSearch(topic, ctx, { top_k: 10 });
    if (top10.some((m) => m.content === expectedContent)) hits10++;
    if (top10.slice(0, 5).some((m) => m.content === expectedContent)) hits5++;
    totalNeedles++;
  }
  const recall5 = totalNeedles > 0 ? hits5 / totalNeedles : 0;
  const recall10 = totalNeedles > 0 ? hits10 / totalNeedles : 0;
  record("search_recall", `recall_at_5_at_${CFG.drawers}`, recall5);
  record("search_recall", `recall_at_10_at_${CFG.drawers}`, recall10);
  console.error(`      recall@5=${(recall5 * 100).toFixed(1)}%  recall@10=${(recall10 * 100).toFixed(1)}%  (n=${totalNeedles})`);

  // ─── 5. search_filter (wing-filtered vs unfiltered) ───────
  console.error(`[5/8] search_filter`);
  const unfilteredSamples: number[] = [];
  const filteredSamples: number[] = [];
  for (const q of queries.slice(0, 30)) {
    const { ms: u } = await timed(() => bus.semanticSearch(q, ctx, { top_k: 10 }));
    unfilteredSamples.push(u);
    const { ms: f } = await timed(() => bus.semanticSearch(q, ctx, { top_k: 10, wing: "wing-0" }));
    filteredSamples.push(f);
  }
  const unfilteredAvg = avg(unfilteredSamples);
  const filteredAvg = avg(filteredSamples);
  const improvementPct = ((unfilteredAvg - filteredAvg) / unfilteredAvg) * 100;
  record("search_filter", "avg_unfiltered_ms", unfilteredAvg);
  record("search_filter", "avg_filtered_ms", filteredAvg);
  record("search_filter", "latency_improvement_pct", improvementPct);
  console.error(`      unfiltered=${unfilteredAvg.toFixed(2)}ms  filtered=${filteredAvg.toFixed(2)}ms  delta=${improvementPct.toFixed(1)}%`);

  // ─── 6. concurrent_search (4 worker pool) ────────────────
  console.error(`[6/8] concurrent_search (4 workers)`);
  const concurrentSamples: number[] = [];
  let errorCount = 0;
  const workerCount = 4;
  const queriesPerWorker = Math.ceil(queries.length / workerCount);
  for (let round = 0; round < 5; round++) {
    const { ms } = await timed(async () => {
      const workers = Array.from({ length: workerCount }, async (_, w) => {
        const slice = queries.slice(w * queriesPerWorker, (w + 1) * queriesPerWorker);
        for (const q of slice) {
          try {
            const inner = await timed(() => bus.semanticSearch(q, ctx, { top_k: 10 }));
            concurrentSamples.push(inner.ms);
          } catch {
            errorCount++;
          }
        }
      });
      await Promise.all(workers);
    });
    void ms;
  }
  record("concurrent_search", "p50_ms", pct(concurrentSamples, 50));
  record("concurrent_search", "p95_ms", pct(concurrentSamples, 95));
  record("concurrent_search", "p99_ms", pct(concurrentSamples, 99));
  record("concurrent_search", "avg_ms", avg(concurrentSamples));
  record("concurrent_search", "error_count", errorCount);
  record("concurrent_search", "total_queries", concurrentSamples.length);
  console.error(`      p50=${pct(concurrentSamples, 50).toFixed(2)}ms  p95=${pct(concurrentSamples, 95).toFixed(2)}ms  errors=${errorCount}`);

  // ─── 7. chromadb_insert equivalent (sequential vs batched) ─
  console.error(`[7/8] chromadb_insert (sequential vs batched)`);
  const seqSize = 100;
  const seqStart = process.hrtime.bigint();
  for (let i = 0; i < seqSize; i++) {
    await bus.publish(
      {
        type: "fact",
        tags: [],
        source_pattern: "seq",
        content: `Sequential insert #${i} ${randomUUID()}`,
        format: "text",
        target_context: ctx.context_id,
      },
      ctx,
    );
  }
  const sequentialMs = Number(process.hrtime.bigint() - seqStart) / 1e6;

  const batched = Array.from({ length: seqSize }, (_, i) => ({
    type: "fact" as KnowledgeType,
    tags: [],
    source_pattern: "batch",
    content: `Batched insert #${i} ${randomUUID()}`,
    format: "text" as const,
    target_context: ctx.context_id,
  }));
  const batchStart = process.hrtime.bigint();
  await bus.publishMany(batched, ctx);
  const batchedMs = Number(process.hrtime.bigint() - batchStart) / 1e6;

  const speedup = sequentialMs / batchedMs;
  record("chromadb_insert", "sequential_ms", sequentialMs);
  record("chromadb_insert", "batched_ms", batchedMs);
  record("chromadb_insert", "speedup_ratio", speedup);
  console.error(`      sequential=${sequentialMs.toFixed(0)}ms  batched=${batchedMs.toFixed(0)}ms  speedup=${speedup.toFixed(1)}x`);

  // ─── 8. memory_search (RSS leak detection) ────────────────
  console.error(`[8/8] memory_search (RSS leak)`);
  const rssStartMb = process.memoryUsage().rss / 1024 / 1024;
  for (let i = 0; i < 200; i++) {
    await bus.semanticSearch(queries[i % queries.length], ctx, { top_k: 10 });
  }
  const rssEndMb = process.memoryUsage().rss / 1024 / 1024;
  record("memory_search", "rss_start_mb", rssStartMb);
  record("memory_search", "rss_end_mb", rssEndMb);
  record("memory_search", "rss_growth_mb", rssEndMb - rssStartMb);
  record("memory_search", "n_calls", 200);
  console.error(`      rss_start=${rssStartMb.toFixed(0)}MB  rss_end=${rssEndMb.toFixed(0)}MB  growth=${(rssEndMb - rssStartMb).toFixed(1)}MB`);

  // ─── Output ───────────────────────────────────────────────
  console.error("");
  const outDir = __dirname;
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(outDir, `kb-scenarios-${SCALE_NAME}-${stamp}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        scale: SCALE_NAME,
        config: CFG,
        provider: PROVIDER_NAME,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        results,
      },
      null,
      2,
    ),
  );
  console.error(`Written: ${outFile}`);
}

main().catch((e) => {
  console.error(`FAIL: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
