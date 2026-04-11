#!/usr/bin/env tsx
/**
 * Performance baseline comparator.
 *
 * Reads the most recent `results-*.json` from `scripts/perf/` and
 * compares it against the baseline file passed as the first argument
 * (defaults to `perf-baseline.json` in the repo root). Fails (exit 1)
 * if any benchmark exceeds 1.20× the baseline p95 — that's the
 * 20% regression budget.
 *
 * Usage:
 *   tsx scripts/perf/compare-baseline.ts perf-baseline.json
 *   tsx scripts/perf/compare-baseline.ts perf-baseline.json --update
 *
 * The --update flag overwrites the baseline file with the most recent
 * results. Use this consciously after a deliberate perf change.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

interface BenchResult {
  name: string;
  iterations: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

interface ResultFile {
  timestamp: string;
  scale: number;
  provider: string;
  node: string;
  platform: string;
  results: BenchResult[];
}

function loadLatestResults(): ResultFile {
  const dir = __dirname;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("results-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.error("No results-*.json found. Run `npm run perf:kb:scale` first.");
    process.exit(1);
  }
  const path = join(dir, files[0]);
  return JSON.parse(readFileSync(path, "utf-8")) as ResultFile;
}

function loadBaseline(path: string): ResultFile | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ResultFile;
  } catch {
    return null;
  }
}

function compare(latest: ResultFile, baseline: ResultFile): boolean {
  const TOLERANCE = 1.2;
  let pass = true;

  console.error(`\n=== Performance comparison ===`);
  console.error(`Latest:   ${latest.timestamp}  scale=${latest.scale}  provider=${latest.provider}`);
  console.error(`Baseline: ${baseline.timestamp}  scale=${baseline.scale}  provider=${baseline.provider}`);
  console.error(`Tolerance: ${((TOLERANCE - 1) * 100).toFixed(0)}% over baseline p95\n`);

  const baselineByName = new Map(baseline.results.map((r) => [r.name, r]));

  for (const cur of latest.results) {
    const base = baselineByName.get(cur.name);
    if (!base) {
      console.error(`  ${pad(cur.name, 40)}  NEW (no baseline)  p95=${fmt(cur.p95Ms)}ms`);
      continue;
    }
    const ratio = cur.p95Ms / base.p95Ms;
    const ok = ratio <= TOLERANCE;
    const symbol = ok ? "✓" : "✗";
    const delta = ((ratio - 1) * 100).toFixed(1).padStart(6);
    console.error(
      `  ${symbol} ${pad(cur.name, 40)}  p95=${fmt(cur.p95Ms)}ms  baseline=${fmt(base.p95Ms)}ms  delta=${delta}%`,
    );
    if (!ok) pass = false;
  }

  console.error(pass ? "\nResult: PASS" : "\nResult: FAIL — performance regression");
  return pass;
}

function pad(s: string, w: number): string {
  return s.padEnd(w);
}

function fmt(n: number): string {
  return n.toFixed(2).padStart(8);
}

function main(): void {
  const baselinePath = process.argv[2] ?? join(REPO_ROOT, "perf-baseline.json");
  const update = process.argv.includes("--update");

  const latest = loadLatestResults();

  if (update) {
    writeFileSync(baselinePath, JSON.stringify(latest, null, 2));
    console.error(`Baseline updated: ${baselinePath}`);
    return;
  }

  const baseline = loadBaseline(baselinePath);
  if (!baseline) {
    console.error(
      `No baseline found at ${baselinePath}. Run with --update to seed it.`,
    );
    process.exit(1);
  }

  const ok = compare(latest, baseline);
  process.exit(ok ? 0 : 1);
}

main();
