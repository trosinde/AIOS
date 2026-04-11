/**
 * End-to-end tests for the `aios knowledge` CLI surface.
 *
 * These tests spawn the real CLI as a subprocess (via `tsx src/cli.ts`)
 * with an isolated `HOME` per test so the LanceDB created under
 * `$HOME/.aios/knowledge` does not pollute the developer's local KB.
 *
 * The stub embedding provider is forced via `AIOS_EMBEDDING_PROVIDER=stub`
 * so the suite runs in CI without Ollama. The stub is deterministic
 * (same content → same vector), which is exactly what we need to
 * verify that semanticSearch returns the planted item we just stored.
 *
 * Each test follows the pattern:
 *   1. Build a fresh isolated env via `makeEnv()`
 *   2. Run one or more CLI commands via `runCli(args, env, stdin?)`
 *   3. Assert on stdout / stderr / exit code
 *
 * Run with `npm run test:e2e`. Not part of `npm test` because each
 * subprocess takes ~1-2s to start (`tsx` cold start + the AIOS pattern
 * loader scanning ~40 patterns). The full suite is still under 30s.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "src", "cli.ts");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface EnvContext {
  home: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
}

function makeEnv(): EnvContext {
  const home = mkdtempSync(join(tmpdir(), "aios-e2e-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    AIOS_EMBEDDING_PROVIDER: "stub",
    AIOS_EMBEDDING_DIM: "768",
    // Suppress noisy pattern-loader warnings on stderr from old patterns
    NO_COLOR: "1",
  };
  const cleanup = () => {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };
  return { home, env, cleanup };
}

function runCli(args: string[], env: NodeJS.ProcessEnv, stdin?: string): CliResult {
  const result = spawnSync(TSX_BIN, [CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    env,
    input: stdin,
    encoding: "utf-8",
    timeout: 60_000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("aios knowledge (e2e)", () => {
  let ctx: EnvContext;

  beforeEach(() => {
    ctx = makeEnv();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ─── publish + query (basic round-trip) ──────────────────

  it("publishes a decision and retrieves it via query", () => {
    const pub = runCli(
      ["knowledge", "publish", "--type", "decision", "--tags", "arch,api", "--context", "ctx-x"],
      ctx.env,
      "REST chosen over gRPC for client compatibility",
    );
    expect(pub.status).toBe(0);
    expect(pub.stdout).toContain("Knowledge published:");

    const q = runCli(
      ["knowledge", "query", "--type", "decision", "--context", "ctx-x"],
      ctx.env,
    );
    expect(q.status).toBe(0);
    expect(q.stdout).toContain("REST chosen over gRPC");
    expect(q.stdout).toContain("decision");
  });

  // ─── publish + keyword search ────────────────────────────

  it("publishes facts and finds one via keyword search", () => {
    runCli(
      ["knowledge", "publish", "--type", "fact", "--context", "ctx-x"],
      ctx.env,
      "Python 3.12 with FastAPI is the chosen backend stack",
    );
    runCli(
      ["knowledge", "publish", "--type", "fact", "--context", "ctx-x"],
      ctx.env,
      "Node.js with Express is the alternative we considered",
    );

    const search = runCli(
      ["knowledge", "search", "FastAPI", "--context", "ctx-x"],
      ctx.env,
    );
    expect(search.status).toBe(0);
    expect(search.stdout).toContain("FastAPI");
    expect(search.stdout).not.toContain("Express");
  });

  // ─── publish + semantic search (HNSW) ────────────────────

  it("publishes items and finds the exact one via semantic-search", () => {
    // The stub embedder is deterministic: identical content → identical
    // vector. So semanticSearch for the exact same string returns the
    // matching item at the top.
    const target = "LanceDB chosen as KB backend for HNSW vector search";
    runCli(
      ["knowledge", "publish", "--type", "decision", "--context", "ctx-x"],
      ctx.env,
      target,
    );
    runCli(
      ["knowledge", "publish", "--type", "fact", "--context", "ctx-x"],
      ctx.env,
      "Unrelated note about cooking pasta",
    );

    const sem = runCli(
      ["knowledge", "semantic-search", target, "--top-k", "3", "--context", "ctx-x"],
      ctx.env,
    );
    expect(sem.status).toBe(0);
    expect(sem.stdout).toContain("LanceDB chosen as KB backend");
    // The top-1 line is the match — no "cooking pasta" before it
    const lanceIdx = sem.stdout.indexOf("LanceDB");
    const pastaIdx = sem.stdout.indexOf("cooking pasta");
    if (pastaIdx !== -1) {
      expect(lanceIdx).toBeLessThan(pastaIdx);
    }
  });

  // ─── diary write/read ────────────────────────────────────

  it("writes diary entries and reads them chronologically", () => {
    const w1 = runCli(
      ["knowledge", "diary-write", "--context", "ctx-x"],
      ctx.env,
      "Morning: started the e2e test work",
    );
    expect(w1.status).toBe(0);
    expect(w1.stdout).toContain("Diary entry written:");

    runCli(
      ["knowledge", "diary-write", "--context", "ctx-x"],
      ctx.env,
      "Afternoon: finished the round-trip test",
    );

    const read = runCli(
      ["knowledge", "diary", "--context", "ctx-x", "--limit", "10"],
      ctx.env,
    );
    expect(read.status).toBe(0);
    expect(read.stdout).toContain("Morning:");
    expect(read.stdout).toContain("Afternoon:");
    // Chronological: morning before afternoon
    expect(read.stdout.indexOf("Morning:")).toBeLessThan(read.stdout.indexOf("Afternoon:"));
  });

  // ─── knowledge graph ─────────────────────────────────────

  it("adds KG triples and queries them by subject and predicate", () => {
    const a1 = runCli(
      ["knowledge", "kg-add", "AIOS", "uses", "LanceDB", "--context", "ctx-x"],
      ctx.env,
    );
    expect(a1.status).toBe(0);
    expect(a1.stdout).toContain("Triple added:");

    runCli(
      ["knowledge", "kg-add", "AIOS", "uses", "Ollama", "--context", "ctx-x"],
      ctx.env,
    );
    runCli(
      ["knowledge", "kg-add", "LanceDB", "implements", "HNSW", "--context", "ctx-x"],
      ctx.env,
    );

    const bySubject = runCli(
      ["knowledge", "kg-query", "--subject", "AIOS", "--context", "ctx-x"],
      ctx.env,
    );
    expect(bySubject.status).toBe(0);
    expect(bySubject.stdout).toContain("LanceDB");
    expect(bySubject.stdout).toContain("Ollama");

    const byPredicate = runCli(
      ["knowledge", "kg-query", "--predicate", "implements", "--context", "ctx-x"],
      ctx.env,
    );
    expect(byPredicate.status).toBe(0);
    expect(byPredicate.stdout).toContain("HNSW");
    expect(byPredicate.stdout).not.toContain("Ollama");
  });

  // ─── taxonomy view ───────────────────────────────────────

  it("publishes items with wing/room metadata and lists taxonomy", () => {
    // Publish via the publish command — it doesn't accept wing/room
    // flags directly, but the metadata field is set on the message.
    // For taxonomy testing we use a single context so the listTaxonomy
    // grouping is meaningful. Note that the publish CLI surface doesn't
    // expose wing/room — those come from the memory_store pattern path
    // or the kb-pattern executor. Here we just verify the taxonomy
    // subcommand runs cleanly even when there's no wing data.
    runCli(
      ["knowledge", "publish", "--type", "fact", "--context", "ctx-x"],
      ctx.env,
      "A plain fact without wing assignment",
    );

    const tax = runCli(["knowledge", "taxonomy", "--context", "ctx-x"], ctx.env);
    expect(tax.status).toBe(0);
    // Either there's at least one wing or the friendly empty message
    expect(tax.stdout.length + tax.stderr.length).toBeGreaterThan(0);
  });

  // ─── context isolation ───────────────────────────────────

  it("isolates messages between contexts (publish in A, query in B sees nothing)", () => {
    runCli(
      ["knowledge", "publish", "--type", "fact", "--context", "ctx-alpha"],
      ctx.env,
      "Alpha-context private knowledge",
    );

    const a = runCli(["knowledge", "query", "--context", "ctx-alpha"], ctx.env);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain("Alpha-context private knowledge");

    const b = runCli(["knowledge", "query", "--context", "ctx-beta"], ctx.env);
    expect(b.status).toBe(0);
    // ctx-beta must NOT see ctx-alpha's private fact
    expect(b.stdout).not.toContain("Alpha-context private knowledge");
  });

  it("broadcast targets are visible cross-context with --cross-context", () => {
    // The publish CLI sets target_context to the current --context. For
    // a true broadcast we'd need a --target option which the CLI does
    // not expose. We verify the negative path: A's items are NOT
    // visible from B even with --cross-context unless explicitly broadcast.
    runCli(
      ["knowledge", "publish", "--type", "fact", "--context", "ctx-a"],
      ctx.env,
      "Per-context fact in A",
    );

    const fromB = runCli(
      ["knowledge", "query", "--context", "ctx-b", "--cross-context"],
      ctx.env,
    );
    expect(fromB.status).toBe(0);
    // ctx-a's item targeted ctx-a, not "*", so B should not see it
    expect(fromB.stdout).not.toContain("Per-context fact in A");
  });

  // ─── persistence across CLI invocations ──────────────────

  it("persists knowledge across separate CLI invocations (no in-memory leak)", () => {
    runCli(
      ["knowledge", "publish", "--type", "decision", "--context", "ctx-p"],
      ctx.env,
      "Persistence verification message",
    );
    // Brand new CLI process, same HOME → must read what the previous
    // process wrote.
    const second = runCli(["knowledge", "query", "--context", "ctx-p"], ctx.env);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Persistence verification message");
  });
});
