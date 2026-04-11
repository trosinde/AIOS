import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { dirname } from "path";
import type { ExecutionRecord, PatternStats } from "../types.js";

/**
 * ExecutionMemory – persistent learning log for capability-based provider selection.
 *
 * Stores every pattern execution (success, retry, failure) in a JSON file
 * so the selector can downgrade unreliable providers and promote proven ones.
 *
 * Statistics use *first attempts only* – retries don't count toward success rate
 * because a successful retry still means the first attempt was a miss.
 *
 * ─── Design notes ───────────────────────────────────────
 *
 * Context-scoping: Every record is tagged with the active `contextId`. The
 * stats APIs filter to the memory's own context by default so a failed
 * summarization in Context A cannot disqualify a provider for a critical
 * compliance task in Context B. The raw `allRecords()` escape hatch is
 * available for cross-context introspection (e.g. `aios memory stats --all`).
 *
 * Concurrency: The Engine runs steps via `Promise.all`, so multiple `log()`
 * calls can race. All writes go through an internal serial promise queue,
 * and the actual save is atomic (write to `<path>.tmp` then `rename`),
 * so a crash mid-write cannot leave a half-written file behind.
 *
 * Bounded size: records are capped at `MAX_RECORDS`. When exceeded, oldest
 * records are pruned FIFO. This prevents `memory.json` from growing
 * unbounded over long sessions.
 */

const DEFAULT_MAX_RECORDS = 10_000;

interface MemoryStoreV1 {
  version: 1;
  records: ExecutionRecord[];
}

type MemoryStore = MemoryStoreV1;

export class ExecutionMemory {
  private store: MemoryStore;
  private writeQueue: Promise<void> = Promise.resolve();
  private maxRecords: number;

  constructor(
    private filePath: string,
    private contextId: string = "default",
    options: { maxRecords?: number } = {},
  ) {
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.store = this.load();
  }

  /**
   * Append a new execution record. The record is tagged with this memory's
   * contextId (overriding any contextId set by the caller).
   *
   * Serialized through an internal queue so parallel calls can't corrupt
   * the file.
   */
  log(record: ExecutionRecord): void {
    const stamped: ExecutionRecord = { ...record, contextId: this.contextId };
    this.store.records.push(stamped);
    if (this.store.records.length > this.maxRecords) {
      this.store.records = this.store.records.slice(-this.maxRecords);
    }
    this.scheduleSave();
  }

  /** Per-provider stats for a specific pattern (first attempts, current context only). */
  getStats(pattern: string): PatternStats[] {
    const firstAttempts = this.store.records.filter(
      (r) =>
        r.pattern === pattern &&
        r.attempt === 1 &&
        r.contextId === this.contextId,
    );

    const grouped = new Map<string, ExecutionRecord[]>();
    for (const r of firstAttempts) {
      const list = grouped.get(r.provider) ?? [];
      list.push(r);
      grouped.set(r.provider, list);
    }

    return Array.from(grouped.entries()).map(([provider, records]) => {
      const successes = records.filter((r) => r.outcome === "success").length;
      const rate = records.length > 0 ? (1000 * successes) / records.length : 0;
      return {
        pattern,
        provider,
        costTier: records[0].costTier,
        totalRuns: records.length,
        successRate: Math.round(rate) / 10,
        avgDurationMs: Math.round(
          records.reduce((sum, r) => sum + r.durationMs, 0) / records.length,
        ),
      };
    });
  }

  /** Global first-attempt reliability for a provider (current context only). */
  getProviderReliability(provider: string): number {
    const records = this.store.records.filter(
      (r) =>
        r.provider === provider &&
        r.attempt === 1 &&
        r.contextId === this.contextId,
    );
    if (records.length === 0) return -1;
    const successes = records.filter((r) => r.outcome === "success").length;
    return Math.round((1000 * successes) / records.length) / 10;
  }

  /**
   * Reset memory (optionally filtered by pattern/provider).
   * Only affects the current context. Returns number of deleted records.
   */
  reset(options?: { pattern?: string; provider?: string }): number {
    const before = this.store.records.length;
    const matches = (r: ExecutionRecord) => {
      if (r.contextId !== this.contextId) return false;
      if (options?.pattern && r.pattern !== options.pattern) return false;
      if (options?.provider && r.provider !== options.provider) return false;
      return true;
    };
    this.store.records = this.store.records.filter((r) => !matches(r));
    this.scheduleSave();
    return before - this.store.records.length;
  }

  /** All stats across all patterns in the current context. */
  allStats(): PatternStats[] {
    const patterns = new Set(
      this.store.records
        .filter((r) => r.contextId === this.contextId)
        .map((r) => r.pattern),
    );
    const result: PatternStats[] = [];
    for (const pattern of patterns) {
      result.push(...this.getStats(pattern));
    }
    return result.sort((a, b) => {
      const byPattern = (a.pattern ?? "").localeCompare(b.pattern ?? "");
      return byPattern !== 0 ? byPattern : a.provider.localeCompare(b.provider);
    });
  }

  /** Raw record count (includes ALL contexts) – useful for tests. */
  recordCount(): number {
    return this.store.records.length;
  }

  /**
   * Wait for all pending writes to flush to disk.
   * Tests and graceful-shutdown paths should await this.
   */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  // ─── Private ────────────────────────────────────────

  private load(): MemoryStore {
    if (!existsSync(this.filePath)) {
      return { version: 1, records: [] };
    }
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf-8");
    } catch {
      return { version: 1, records: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { version: 1, records: [] };
    }

    if (!isMemoryStore(parsed)) {
      return { version: 1, records: [] };
    }

    // Validate and filter each record. Drop malformed entries instead of
    // crashing downstream in getStats().
    const valid = parsed.records.filter(isValidExecutionRecord);
    return { version: 1, records: valid };
  }

  /**
   * Queue a save. Writes are serialized through a promise chain so that
   * `log()` from parallel steps cannot interleave.
   */
  private scheduleSave(): void {
    const snapshot = JSON.stringify(this.store, null, 2);
    this.writeQueue = this.writeQueue.then(() => this.atomicWrite(snapshot));
  }

  /**
   * Atomic-ish write: write to a temp file, then rename over the target.
   * `rename` is atomic on POSIX filesystems, so a crash mid-write leaves
   * either the old file or the new file, never a half-written file.
   */
  private async atomicWrite(snapshot: string): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    try {
      writeFileSync(tmp, snapshot, "utf-8");
      renameSync(tmp, this.filePath);
    } catch (e) {
      // Clean up orphaned tmp on error.
      try { unlinkSync(tmp); } catch { /* ignore */ }
      // Log to stderr but don't crash the caller: memory is best-effort.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`⚠️ ExecutionMemory: write failed (${msg})`);
    }
  }
}

// ─── Schema Guards ───────────────────────────────────────

function isMemoryStore(v: unknown): v is MemoryStoreV1 {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return Array.isArray(obj.records);
}

function isValidExecutionRecord(v: unknown): v is ExecutionRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.timestamp === "string" &&
    typeof r.pattern === "string" &&
    typeof r.provider === "string" &&
    typeof r.model === "string" &&
    typeof r.costTier === "number" &&
    typeof r.outcome === "string" &&
    typeof r.attempt === "number" &&
    typeof r.durationMs === "number" &&
    typeof r.tokensInput === "number" &&
    typeof r.tokensOutput === "number" &&
    // contextId is new in v2 — legacy records default to "default"
    (r.contextId === undefined || typeof r.contextId === "string")
  );
}
