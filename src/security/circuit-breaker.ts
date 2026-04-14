/**
 * Circuit Breaker – Layer 7: Step / Time / Error Limiting.
 *
 * Stops a workflow before it runs away when there is no human to Ctrl+C.
 *
 * Activation model:
 *   - Attended (interactive: true, default) → disabled (unlimited). The
 *     human at the terminal enforces the real limit via Ctrl+C.
 *   - Unattended (interactive: false)       → enabled with strict caps
 *     on write steps, total steps, wall-clock time, and consecutive errors.
 *
 * This module extracts (and expands) the inline writeStep check that used
 * to live in engine.ts.
 */

// ─── Types ────────────────────────────────────────────────

export type BreakerState = "closed" | "open";

export interface CircuitBreakerConfig {
  enabled: boolean;
  maxWriteSteps: number;
  maxTotalSteps: number;
  maxDurationMs: number;
  maxConsecutiveErrors: number;
}

export interface BreakerStatus {
  state: BreakerState;
  writeSteps: number;
  totalSteps: number;
  consecutiveErrors: number;
  elapsedMs: number;
  trippedReason?: string;
}

// ─── Defaults ─────────────────────────────────────────────

export const DEFAULT_BREAKER_CONFIG: CircuitBreakerConfig = {
  enabled: false,
  maxWriteSteps: Infinity,
  maxTotalSteps: Infinity,
  maxDurationMs: Infinity,
  maxConsecutiveErrors: Infinity,
};

export const UNATTENDED_BREAKER_CONFIG: Partial<CircuitBreakerConfig> = {
  enabled: true,
  maxWriteSteps: 10,
  maxTotalSteps: 25,
  maxDurationMs: 1_200_000,
  maxConsecutiveErrors: 3,
};

// ─── Circuit Breaker ──────────────────────────────────────

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: BreakerState = "closed";
  private writeSteps = 0;
  private totalSteps = 0;
  private consecutiveErrors = 0;
  private startedAt = Date.now();
  private trippedReason?: string;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_BREAKER_CONFIG, ...config };
  }

  /**
   * Factory that wires the breaker from an ExecutionContext.
   * Unattended contexts opt into strict caps; attended contexts get a
   * disabled breaker unless max_write_steps is set explicitly.
   */
  static fromContext(
    ctx: { interactive?: boolean; max_write_steps?: number },
    overrides: Partial<CircuitBreakerConfig> = {},
  ): CircuitBreaker {
    if (ctx.interactive === false) {
      const base: Partial<CircuitBreakerConfig> = {
        ...UNATTENDED_BREAKER_CONFIG,
      };
      if (ctx.max_write_steps !== undefined) base.maxWriteSteps = ctx.max_write_steps;
      return new CircuitBreaker({ ...base, ...overrides });
    }
    return new CircuitBreaker({
      enabled: ctx.max_write_steps !== undefined,
      maxWriteSteps: ctx.max_write_steps ?? Infinity,
      ...overrides,
    });
  }

  /** Reset all counters and timers. Call before executing a workflow. */
  reset(): void {
    this.state = "closed";
    this.writeSteps = 0;
    this.totalSteps = 0;
    this.consecutiveErrors = 0;
    this.startedAt = Date.now();
    this.trippedReason = undefined;
  }

  /**
   * Call before dispatching a step. Throws when the breaker is open or
   * any limit is exceeded. Increments counters on pass.
   */
  beforeStep(_stepId: string, isWrite: boolean): void {
    if (!this.config.enabled) {
      this.totalSteps++;
      if (isWrite) this.writeSteps++;
      return;
    }

    if (this.state === "open") {
      throw new Error(
        `Circuit Breaker open${this.trippedReason ? `: ${this.trippedReason}` : ""}`,
      );
    }

    // Duration check (evaluated on each step so long-running workflows trip promptly)
    const elapsed = Date.now() - this.startedAt;
    if (elapsed >= this.config.maxDurationMs) {
      this.trip(`duration ${elapsed}ms exceeds limit of ${this.config.maxDurationMs}ms`);
    }

    if (this.totalSteps >= this.config.maxTotalSteps) {
      this.trip(`${this.totalSteps} total steps reached limit of ${this.config.maxTotalSteps}`);
    }

    if (isWrite && this.writeSteps >= this.config.maxWriteSteps) {
      this.trip(
        `${this.writeSteps} write-steps would exceed limit of ${this.config.maxWriteSteps}`,
      );
    }

    if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      this.trip(
        `${this.consecutiveErrors} consecutive errors reached limit of ${this.config.maxConsecutiveErrors}`,
      );
    }

    this.totalSteps++;
    if (isWrite) this.writeSteps++;
  }

  /** Call from a catch-block after a step fails. */
  recordError(_stepId: string, _error: string): void {
    this.consecutiveErrors++;
  }

  /** Call after a step completes successfully. */
  recordSuccess(_stepId: string): void {
    this.consecutiveErrors = 0;
  }

  /** Snapshot of the breaker for logging / monitoring. */
  status(): BreakerStatus {
    return {
      state: this.state,
      writeSteps: this.writeSteps,
      totalSteps: this.totalSteps,
      consecutiveErrors: this.consecutiveErrors,
      elapsedMs: Date.now() - this.startedAt,
      trippedReason: this.trippedReason,
    };
  }

  private trip(reason: string): never {
    this.state = "open";
    this.trippedReason = reason;
    throw new Error(`Circuit Breaker: ${reason}`);
  }
}
