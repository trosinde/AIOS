import { describe, it, expect } from "vitest";
import { PolicyEngine, DEFAULT_POLICIES } from "./policy-engine.js";
import { trustedTaint, userInputTaint } from "./taint-tracker.js";
import type { ExecutionContext } from "../types.js";

const baseCtx = (): ExecutionContext => ({
  trace_id: "t-1",
  context_id: "test",
  started_at: Date.now(),
  compliance_tags: [],
  allowed_driver_capabilities: ["file_read", "file_write"],
});

describe("PolicyEngine – Phase 5.3 Compliance Tags", () => {
  it("erlaubt Pattern ohne Compliance-Tags in beliebigem Context", () => {
    const eng = new PolicyEngine([]);
    const decision = eng.check("execute_tool_pattern", trustedTaint("system"), "t-1", {
      patternComplianceTags: undefined,
      contextComplianceTags: [],
      patternName: "noop",
    });
    expect(decision.allowed).toBe(true);
  });

  it("blockt Pattern mit Compliance-Tag wenn Context ihn nicht bietet", () => {
    const eng = new PolicyEngine([]);
    const decision = eng.check("execute_tool_pattern", trustedTaint("system"), "t-1", {
      patternComplianceTags: ["cra"],
      contextComplianceTags: [],
      patternName: "cra_audit",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("cra");
  });

  it("erlaubt Pattern wenn Context alle geforderten Tags bietet", () => {
    const eng = new PolicyEngine([]);
    const decision = eng.check("execute_tool_pattern", trustedTaint("system"), "t-1", {
      patternComplianceTags: ["cra", "iec62443"],
      contextComplianceTags: ["iec62443", "cra", "extra"],
      patternName: "regulated",
    });
    expect(decision.allowed).toBe(true);
  });

  it("listet fehlende Tags im reason auf", () => {
    const eng = new PolicyEngine([]);
    const decision = eng.check("execute_tool_pattern", trustedTaint("system"), "t-1", {
      patternComplianceTags: ["cra", "iec62443"],
      contextComplianceTags: ["cra"],
      patternName: "p",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("iec62443");
    expect(decision.reason).not.toMatch(/\bcra\b.*\bcra\b/); // cra ist erlaubt, sollte nicht doppelt
  });
});

describe("PolicyEngine – Phase 5.3 Driver Capabilities", () => {
  it("erlaubt file_read/file_write per Default", () => {
    const eng = new PolicyEngine([]);
    const ctx = baseCtx();
    const decision = eng.checkDriverCapabilities(["file_read", "file_write"], ctx, "mermaid", "t-1");
    expect(decision.allowed).toBe(true);
  });

  it("blockt network ohne explizite Allowance", () => {
    const eng = new PolicyEngine([]);
    const ctx = baseCtx();
    const decision = eng.checkDriverCapabilities(["network"], ctx, "curl", "t-1");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("network");
  });

  it("blockt spawn ohne Allowance", () => {
    const eng = new PolicyEngine([]);
    const ctx = baseCtx();
    const decision = eng.checkDriverCapabilities(["spawn"], ctx, "shell", "t-1");
    expect(decision.allowed).toBe(false);
  });

  it("erlaubt network wenn Context es freischaltet", () => {
    const eng = new PolicyEngine([]);
    const ctx: ExecutionContext = { ...baseCtx(), allowed_driver_capabilities: ["file_read", "network"] };
    const decision = eng.checkDriverCapabilities(["network", "file_read"], ctx, "curl", "t-1");
    expect(decision.allowed).toBe(true);
  });
});

describe("PolicyEngine – Default Integrity Policies (Regression)", () => {
  it("DEFAULT_POLICIES blocken execute_tool_pattern bei untrusted Input", () => {
    const eng = new PolicyEngine(DEFAULT_POLICIES);
    const decision = eng.check("execute_tool_pattern", userInputTaint("user"), "t-1");
    expect(decision.allowed).toBe(false);
    expect(decision.violatedPolicy?.action).toBe("execute_tool_pattern");
  });

  it("DEFAULT_POLICIES erlauben execute_tool_pattern bei trusted Input", () => {
    const eng = new PolicyEngine(DEFAULT_POLICIES);
    const decision = eng.check("execute_tool_pattern", trustedTaint("system"), "t-1");
    expect(decision.allowed).toBe(true);
  });
});
