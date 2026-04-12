import { describe, it, expect } from "vitest";
import { PolicyEngine, DEFAULT_POLICIES } from "./policy-engine.js";
import { userInputTaint, trustedTaint } from "./taint-tracker.js";

describe("PolicyEngine – Phase 5.4 Strict vs Relaxed", () => {
  it("relaxed mode (empty policies) erlaubt execute_tool_pattern bei untrusted", () => {
    const eng = new PolicyEngine([]);
    const decision = eng.check("execute_tool_pattern", userInputTaint("user"), "t-1");
    expect(decision.allowed).toBe(true);
  });

  it("strict mode (DEFAULT_POLICIES) blockt execute_tool_pattern bei untrusted", () => {
    const eng = new PolicyEngine([...DEFAULT_POLICIES]);
    const decision = eng.check("execute_tool_pattern", userInputTaint("user"), "t-1");
    expect(decision.allowed).toBe(false);
    expect(decision.violatedPolicy?.action).toBe("execute_tool_pattern");
  });

  it("strict mode erlaubt execute_tool_pattern bei trusted", () => {
    const eng = new PolicyEngine([...DEFAULT_POLICIES]);
    const decision = eng.check("execute_tool_pattern", trustedTaint("system"), "t-1");
    expect(decision.allowed).toBe(true);
  });

  it("strict mode blockt write_knowledge bei untrusted", () => {
    const eng = new PolicyEngine([...DEFAULT_POLICIES]);
    const decision = eng.check("write_knowledge", userInputTaint("user"), "t-1");
    expect(decision.allowed).toBe(false);
  });

  it("strict mode blockt modify_plan immer", () => {
    const eng = new PolicyEngine([...DEFAULT_POLICIES]);
    const decision = eng.check("modify_plan", trustedTaint("system"), "t-1");
    expect(decision.allowed).toBe(false);
  });

  it("strict mode erlaubt execute_llm_pattern bei untrusted (warn-only)", () => {
    const eng = new PolicyEngine([...DEFAULT_POLICIES]);
    const decision = eng.check("execute_llm_pattern", userInputTaint("user"), "t-1");
    expect(decision.allowed).toBe(true);
  });

  it("compliance_tags werden in beiden Modi geprüft", () => {
    // Relaxed mode
    const relaxed = new PolicyEngine([]);
    const d1 = relaxed.check("execute_tool_pattern", trustedTaint("s"), "t-1", {
      patternComplianceTags: ["cra"],
      contextComplianceTags: [],
      patternName: "test",
    });
    expect(d1.allowed).toBe(false);

    // Strict mode
    const strict = new PolicyEngine([...DEFAULT_POLICIES]);
    const d2 = strict.check("execute_tool_pattern", trustedTaint("s"), "t-1", {
      patternComplianceTags: ["cra"],
      contextComplianceTags: [],
      patternName: "test",
    });
    expect(d2.allowed).toBe(false);
  });
});
