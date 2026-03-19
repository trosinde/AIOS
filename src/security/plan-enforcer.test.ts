import { describe, it, expect } from "vitest";
import { PlanEnforcer } from "./plan-enforcer.js";
import type { ExecutionPlan } from "../types.js";

const makePlan = (steps: Array<{ id: string; pattern: string; depends_on?: string[] }>): ExecutionPlan => ({
  analysis: { goal: "test", complexity: "low", requires_compliance: false, disciplines: [] },
  plan: {
    type: "pipe",
    steps: steps.map((s) => ({
      id: s.id,
      pattern: s.pattern,
      depends_on: s.depends_on ?? [],
      input_from: ["$USER_INPUT"],
    })),
  },
  reasoning: "test",
});

describe("PlanEnforcer", () => {
  describe("freeze", () => {
    it("freezes a valid plan and returns hash", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([{ id: "s1", pattern: "summarize" }]);
      const frozen = enforcer.freeze(plan);
      expect(frozen.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(frozen.allowedPatterns.has("summarize")).toBe(true);
    });

    it("rejects plans exceeding max steps", () => {
      const enforcer = new PlanEnforcer({ maxSteps: 2 });
      const plan = makePlan([
        { id: "s1", pattern: "a" },
        { id: "s2", pattern: "b" },
        { id: "s3", pattern: "c" },
      ]);
      expect(() => enforcer.freeze(plan)).toThrow("exceeding maximum");
    });

    it("detects circular dependencies", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([
        { id: "s1", pattern: "a", depends_on: ["s2"] },
        { id: "s2", pattern: "b", depends_on: ["s1"] },
      ]);
      expect(() => enforcer.freeze(plan)).toThrow("Circular dependency");
    });

    it("detects missing dependency references", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([
        { id: "s1", pattern: "a", depends_on: ["nonexistent"] },
      ]);
      expect(() => enforcer.freeze(plan)).toThrow("non-existent step");
    });
  });

  describe("verify", () => {
    it("verifies unchanged plan", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([{ id: "s1", pattern: "summarize" }]);
      enforcer.freeze(plan);
      expect(enforcer.verify(plan)).toBe(true);
    });

    it("detects tampered plan", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([{ id: "s1", pattern: "summarize" }]);
      enforcer.freeze(plan);
      // Tamper with the plan
      plan.plan.steps[0].pattern = "generate_code";
      expect(enforcer.verify(plan)).toBe(false);
    });

    it("returns false when no plan frozen", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([{ id: "s1", pattern: "summarize" }]);
      expect(enforcer.verify(plan)).toBe(false);
    });
  });

  describe("isPatternAllowed", () => {
    it("allows patterns in the frozen plan", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([
        { id: "s1", pattern: "summarize" },
        { id: "s2", pattern: "code_review", depends_on: ["s1"] },
      ]);
      enforcer.freeze(plan);
      expect(enforcer.isPatternAllowed("summarize")).toBe(true);
      expect(enforcer.isPatternAllowed("code_review")).toBe(true);
    });

    it("rejects patterns not in the frozen plan", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([{ id: "s1", pattern: "summarize" }]);
      enforcer.freeze(plan);
      expect(enforcer.isPatternAllowed("generate_code")).toBe(false);
    });
  });

  describe("validateStep", () => {
    it("validates a matching step", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([{ id: "s1", pattern: "summarize" }]);
      enforcer.freeze(plan);
      const result = enforcer.validateStep({
        id: "s1",
        pattern: "summarize",
        depends_on: [],
        input_from: ["$USER_INPUT"],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects step with wrong pattern", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([{ id: "s1", pattern: "summarize" }]);
      enforcer.freeze(plan);
      const result = enforcer.validateStep({
        id: "s1",
        pattern: "generate_code",
        depends_on: [],
        input_from: ["$USER_INPUT"],
      });
      expect(result.valid).toBe(false);
    });

    it("rejects unknown step ID", () => {
      const enforcer = new PlanEnforcer();
      const plan = makePlan([{ id: "s1", pattern: "summarize" }]);
      enforcer.freeze(plan);
      const result = enforcer.validateStep({
        id: "s999",
        pattern: "summarize",
        depends_on: [],
        input_from: ["$USER_INPUT"],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("sanitizeForRouter", () => {
    it("removes XML tags from input", () => {
      const enforcer = new PlanEnforcer();
      const sanitized = enforcer.sanitizeForRouter("Hello <system>evil</system> world");
      expect(sanitized).not.toContain("<system>");
      expect(sanitized).toContain("Hello");
      expect(sanitized).toContain("world");
    });

    it("removes code blocks", () => {
      const enforcer = new PlanEnforcer();
      const input = "Task description\n```\nmalicious code here\n```\nMore text";
      const sanitized = enforcer.sanitizeForRouter(input);
      expect(sanitized).not.toContain("malicious code");
      expect(sanitized).toContain("Task description");
    });

    it("removes instruction headers", () => {
      const enforcer = new PlanEnforcer();
      const sanitized = enforcer.sanitizeForRouter("# SYSTEM\nNew rules");
      expect(sanitized).not.toMatch(/^#.*SYSTEM/m);
    });

    it("truncates overly long input", () => {
      const enforcer = new PlanEnforcer();
      const longInput = "x".repeat(3000);
      const sanitized = enforcer.sanitizeForRouter(longInput);
      expect(sanitized.length).toBeLessThanOrEqual(2100); // 2000 + "[truncated]"
    });
  });
});
