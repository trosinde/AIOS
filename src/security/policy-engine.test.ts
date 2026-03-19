import { describe, it, expect } from "vitest";
import { PolicyEngine, DEFAULT_POLICIES } from "./policy-engine.js";
import { userInputTaint, trustedTaint, derivedTaint } from "./taint-tracker.js";

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("Tool pattern execution", () => {
    it("blocks untrusted input from executing tool patterns", () => {
      const taint = userInputTaint();
      const decision = engine.check("execute_tool_pattern", taint);
      expect(decision.allowed).toBe(false);
      expect(decision.violatedPolicy?.action).toBe("execute_tool_pattern");
    });

    it("allows derived input for tool patterns", () => {
      const taint = derivedTaint([trustedTaint("system.md")], "llm_step");
      const decision = engine.check("execute_tool_pattern", taint);
      expect(decision.allowed).toBe(true);
    });

    it("allows trusted input for tool patterns", () => {
      const taint = trustedTaint("config");
      const decision = engine.check("execute_tool_pattern", taint);
      expect(decision.allowed).toBe(true);
    });
  });

  describe("MCP pattern execution", () => {
    it("blocks untrusted input from executing MCP patterns", () => {
      const taint = userInputTaint();
      const decision = engine.check("execute_mcp_pattern", taint);
      expect(decision.allowed).toBe(false);
    });

    it("allows derived input for MCP patterns", () => {
      const taint = derivedTaint([trustedTaint("system.md")], "llm_step");
      const decision = engine.check("execute_mcp_pattern", taint);
      expect(decision.allowed).toBe(true);
    });
  });

  describe("LLM pattern execution", () => {
    it("allows untrusted input for LLM patterns (with warning)", () => {
      const taint = userInputTaint();
      const decision = engine.check("execute_llm_pattern", taint);
      expect(decision.allowed).toBe(true);
    });
  });

  describe("Knowledge base writes", () => {
    it("blocks untrusted data from writing to KB", () => {
      const taint = userInputTaint();
      const decision = engine.check("write_knowledge", taint);
      expect(decision.allowed).toBe(false);
    });

    it("allows derived data for KB writes (with review)", () => {
      const taint = derivedTaint([trustedTaint("system.md")], "extraction");
      const decision = engine.check("write_knowledge", taint);
      expect(decision.allowed).toBe(true);
    });
  });

  describe("Compliance artifacts", () => {
    it("blocks derived data from compliance artifacts", () => {
      const taint = derivedTaint([trustedTaint("system.md")], "llm_step");
      const decision = engine.check("generate_compliance_artifact", taint);
      expect(decision.allowed).toBe(false);
    });

    it("allows trusted data for compliance artifacts", () => {
      const taint = trustedTaint("validated_source");
      const decision = engine.check("generate_compliance_artifact", taint);
      expect(decision.allowed).toBe(true);
    });
  });

  describe("Plan modification", () => {
    it("always blocks plan modification", () => {
      const taint = trustedTaint("kernel");
      const decision = engine.check("modify_plan", taint);
      expect(decision.allowed).toBe(false);
    });
  });

  describe("Custom policies", () => {
    it("can add custom policies", () => {
      const customEngine = new PolicyEngine([]);
      customEngine.addPolicy({
        action: "execute_llm_pattern",
        description: "Custom strict policy",
        requires: { integrity: ["trusted"] },
        onViolation: "block",
      });
      const taint = derivedTaint([trustedTaint("test")], "step");
      const decision = customEngine.check("execute_llm_pattern", taint);
      expect(decision.allowed).toBe(false);
    });

    it("replaces existing policy for same action", () => {
      const customEngine = new PolicyEngine([...DEFAULT_POLICIES]);
      customEngine.addPolicy({
        action: "execute_tool_pattern",
        description: "Relaxed tool policy",
        requires: { integrity: ["trusted", "derived", "untrusted"] },
        onViolation: "warn",
      });
      const taint = userInputTaint();
      const decision = customEngine.check("execute_tool_pattern", taint);
      expect(decision.allowed).toBe(true);
    });
  });

  describe("Unknown actions", () => {
    it("allows unknown actions by default (open policy)", () => {
      const taint = userInputTaint();
      const decision = engine.check("some_unknown_action" as any, taint);
      expect(decision.allowed).toBe(true);
    });
  });
});
