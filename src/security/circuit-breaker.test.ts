import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  describe("Write Step Limiting", () => {
    it("allows write steps within limit", () => {
      const cb = new CircuitBreaker({ enabled: true, maxWriteSteps: 3 });
      cb.reset();
      cb.beforeStep("a", true);
      cb.beforeStep("b", true);
      cb.beforeStep("c", true);
      expect(cb.status().writeSteps).toBe(3);
    });

    it("trips after exceeding maxWriteSteps", () => {
      const cb = new CircuitBreaker({ enabled: true, maxWriteSteps: 2 });
      cb.reset();
      cb.beforeStep("a", true);
      cb.beforeStep("b", true);
      expect(() => cb.beforeStep("c", true)).toThrow(/Circuit Breaker/);
      expect(cb.status().state).toBe("open");
    });

    it("counts only write steps, not read steps", () => {
      const cb = new CircuitBreaker({ enabled: true, maxWriteSteps: 1 });
      cb.reset();
      cb.beforeStep("a", false);
      cb.beforeStep("b", false);
      cb.beforeStep("c", false);
      expect(cb.status().writeSteps).toBe(0);
      expect(cb.status().totalSteps).toBe(3);
    });
  });

  describe("Total Step Limiting", () => {
    it("trips after exceeding maxTotalSteps", () => {
      const cb = new CircuitBreaker({ enabled: true, maxTotalSteps: 2 });
      cb.reset();
      cb.beforeStep("a", false);
      cb.beforeStep("b", false);
      expect(() => cb.beforeStep("c", false)).toThrow(/Circuit Breaker/);
    });
  });

  describe("Duration Limiting", () => {
    it("trips after exceeding maxDurationMs", async () => {
      const cb = new CircuitBreaker({ enabled: true, maxDurationMs: 30 });
      cb.reset();
      await new Promise((r) => setTimeout(r, 50));
      expect(() => cb.beforeStep("a", false)).toThrow(/Circuit Breaker/);
    });
  });

  describe("Consecutive Error Tracking", () => {
    it("trips after maxConsecutiveErrors", () => {
      const cb = new CircuitBreaker({ enabled: true, maxConsecutiveErrors: 2 });
      cb.reset();
      cb.beforeStep("a", false);
      cb.recordError("a", "fail");
      cb.beforeStep("b", false);
      cb.recordError("b", "fail");
      expect(() => cb.beforeStep("c", false)).toThrow(/Circuit Breaker/);
    });

    it("resets error count on recordSuccess", () => {
      const cb = new CircuitBreaker({ enabled: true, maxConsecutiveErrors: 2 });
      cb.reset();
      cb.beforeStep("a", false);
      cb.recordError("a", "fail");
      cb.beforeStep("b", false);
      cb.recordSuccess("b");
      expect(cb.status().consecutiveErrors).toBe(0);
    });

    it("does not trip on non-consecutive errors", () => {
      const cb = new CircuitBreaker({ enabled: true, maxConsecutiveErrors: 2 });
      cb.reset();
      cb.beforeStep("a", false);
      cb.recordError("a", "fail");
      cb.beforeStep("b", false);
      cb.recordSuccess("b");
      cb.beforeStep("c", false);
      cb.recordError("c", "fail");
      // Only 1 consecutive error — should not trip
      cb.beforeStep("d", false);
      expect(cb.status().state).toBe("closed");
    });
  });

  describe("State Machine", () => {
    it("starts in closed state", () => {
      const cb = new CircuitBreaker({ enabled: true });
      expect(cb.status().state).toBe("closed");
    });

    it("transitions to open on trip", () => {
      const cb = new CircuitBreaker({ enabled: true, maxWriteSteps: 1 });
      cb.reset();
      cb.beforeStep("a", true);
      expect(() => cb.beforeStep("b", true)).toThrow();
      expect(cb.status().state).toBe("open");
    });

    it("blocks all steps in open state", () => {
      const cb = new CircuitBreaker({ enabled: true, maxWriteSteps: 1 });
      cb.reset();
      cb.beforeStep("a", true);
      expect(() => cb.beforeStep("b", true)).toThrow();
      expect(() => cb.beforeStep("c", false)).toThrow(/open/);
    });

    it("reset() returns to closed", () => {
      const cb = new CircuitBreaker({ enabled: true, maxWriteSteps: 1 });
      cb.reset();
      cb.beforeStep("a", true);
      try { cb.beforeStep("b", true); } catch { /* expected */ }
      expect(cb.status().state).toBe("open");
      cb.reset();
      expect(cb.status().state).toBe("closed");
      expect(cb.status().writeSteps).toBe(0);
    });
  });

  describe("Attended vs Unattended", () => {
    it("fromContext returns disabled breaker for interactive=true", () => {
      const cb = CircuitBreaker.fromContext({ interactive: true });
      cb.reset();
      for (let i = 0; i < 100; i++) cb.beforeStep(`s${i}`, true);
      expect(cb.status().state).toBe("closed");
    });

    it("fromContext returns enabled breaker for interactive=false", () => {
      const cb = CircuitBreaker.fromContext({ interactive: false });
      cb.reset();
      for (let i = 0; i < 10; i++) cb.beforeStep(`s${i}`, true);
      expect(() => cb.beforeStep("s10", true)).toThrow();
    });

    it("fromContext respects max_write_steps from ExecutionContext", () => {
      const cb = CircuitBreaker.fromContext({ interactive: false, max_write_steps: 2 });
      cb.reset();
      cb.beforeStep("a", true);
      cb.beforeStep("b", true);
      expect(() => cb.beforeStep("c", true)).toThrow();
    });

    it("fromContext merges overrides", () => {
      const cb = CircuitBreaker.fromContext(
        { interactive: false },
        { maxWriteSteps: 1 },
      );
      cb.reset();
      cb.beforeStep("a", true);
      expect(() => cb.beforeStep("b", true)).toThrow();
    });

    it("disabled breaker allows everything", () => {
      const cb = new CircuitBreaker({ enabled: false });
      cb.reset();
      for (let i = 0; i < 1000; i++) cb.beforeStep(`s${i}`, true);
      expect(cb.status().state).toBe("closed");
    });
  });

  describe("Status", () => {
    it("reports current counters", () => {
      const cb = new CircuitBreaker({ enabled: true });
      cb.reset();
      cb.beforeStep("a", true);
      cb.beforeStep("b", false);
      const s = cb.status();
      expect(s.writeSteps).toBe(1);
      expect(s.totalSteps).toBe(2);
    });

    it("includes trippedReason after trip", () => {
      const cb = new CircuitBreaker({ enabled: true, maxWriteSteps: 1 });
      cb.reset();
      cb.beforeStep("a", true);
      try { cb.beforeStep("b", true); } catch { /* expected */ }
      expect(cb.status().trippedReason).toMatch(/write-steps/);
    });

    it("reports elapsedMs", async () => {
      const cb = new CircuitBreaker({ enabled: true });
      cb.reset();
      await new Promise((r) => setTimeout(r, 10));
      expect(cb.status().elapsedMs).toBeGreaterThanOrEqual(10);
    });
  });
});
