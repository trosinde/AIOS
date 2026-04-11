import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
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
 */

interface MemoryStore {
  version: 1;
  records: ExecutionRecord[];
}

export class ExecutionMemory {
  private store: MemoryStore;

  constructor(private filePath: string) {
    this.store = this.load();
  }

  /** Append a new execution record. */
  log(record: ExecutionRecord): void {
    this.store.records.push(record);
    this.save();
  }

  /** Per-provider stats for a specific pattern (first attempts only). */
  getStats(pattern: string): PatternStats[] {
    const firstAttempts = this.store.records.filter(
      (r) => r.pattern === pattern && r.attempt === 1,
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

  /** Global first-attempt reliability for a provider across all patterns. */
  getProviderReliability(provider: string): number {
    const records = this.store.records.filter(
      (r) => r.provider === provider && r.attempt === 1,
    );
    if (records.length === 0) return -1;
    const successes = records.filter((r) => r.outcome === "success").length;
    return Math.round((1000 * successes) / records.length) / 10;
  }

  /** Reset memory (optionally filtered by pattern/provider). Returns number of deleted records. */
  reset(options?: { pattern?: string; provider?: string }): number {
    const before = this.store.records.length;
    if (options?.pattern && options?.provider) {
      this.store.records = this.store.records.filter(
        (r) => r.pattern !== options.pattern || r.provider !== options.provider,
      );
    } else if (options?.pattern) {
      this.store.records = this.store.records.filter(
        (r) => r.pattern !== options.pattern,
      );
    } else if (options?.provider) {
      this.store.records = this.store.records.filter(
        (r) => r.provider !== options.provider,
      );
    } else {
      this.store.records = [];
    }
    this.save();
    return before - this.store.records.length;
  }

  /** All stats across all patterns – for `aios memory stats` output. */
  allStats(): PatternStats[] {
    const patterns = new Set(this.store.records.map((r) => r.pattern));
    const result: PatternStats[] = [];
    for (const pattern of patterns) {
      result.push(...this.getStats(pattern));
    }
    return result.sort((a, b) => {
      const byPattern = (a.pattern ?? "").localeCompare(b.pattern ?? "");
      return byPattern !== 0 ? byPattern : a.provider.localeCompare(b.provider);
    });
  }

  /** Raw record count – useful for tests. */
  recordCount(): number {
    return this.store.records.length;
  }

  // ─── Private ────────────────────────────────────────

  private load(): MemoryStore {
    if (!existsSync(this.filePath)) {
      return { version: 1, records: [] };
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as MemoryStore;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.records)) {
        return { version: 1, records: [] };
      }
      return { version: 1, records: parsed.records };
    } catch {
      // Corrupt file → start fresh, don't crash the CLI
      return { version: 1, records: [] };
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), "utf-8");
  }
}
