import { describe, it, expect } from "vitest";
import {
  userInputTaint,
  trustedTaint,
  derivedTaint,
  mergeIntegrity,
  mergeConfidentiality,
  meetsIntegrity,
  label,
} from "./taint-tracker.js";

describe("TaintTracker", () => {
  describe("userInputTaint", () => {
    it("creates untrusted label for user input", () => {
      const taint = userInputTaint();
      expect(taint.integrity).toBe("untrusted");
      expect(taint.confidentiality).toBe("public");
      expect(taint.source).toBe("user_input");
    });
  });

  describe("trustedTaint", () => {
    it("creates trusted label for system data", () => {
      const taint = trustedTaint("system.md");
      expect(taint.integrity).toBe("trusted");
      expect(taint.confidentiality).toBe("internal");
      expect(taint.source).toBe("system.md");
    });
  });

  describe("derivedTaint", () => {
    it("downgrades trusted inputs to derived after LLM processing", () => {
      const input = trustedTaint("system.md");
      const result = derivedTaint([input], "llm_step_1");
      expect(result.integrity).toBe("derived");
      expect(result.transformations).toContain("llm_step_1");
    });

    it("keeps untrusted integrity when any input is untrusted", () => {
      const trusted = trustedTaint("system.md");
      const untrusted = userInputTaint();
      const result = derivedTaint([trusted, untrusted], "llm_step_1");
      expect(result.integrity).toBe("untrusted");
    });

    it("merges sources from all inputs", () => {
      const a = trustedTaint("source_a");
      const b = trustedTaint("source_b");
      const result = derivedTaint([a, b], "merge");
      expect(result.source).toContain("source_a");
      expect(result.source).toContain("source_b");
    });

    it("takes maximum confidentiality", () => {
      const pub = { ...trustedTaint("a"), confidentiality: "public" as const };
      const conf = { ...trustedTaint("b"), confidentiality: "confidential" as const };
      const result = derivedTaint([pub, conf], "merge");
      expect(result.confidentiality).toBe("confidential");
    });

    it("returns untrusted for empty inputs", () => {
      const result = derivedTaint([], "empty");
      expect(result.integrity).toBe("untrusted");
    });
  });

  describe("mergeIntegrity", () => {
    it("returns minimum integrity (conservative)", () => {
      expect(mergeIntegrity(["trusted", "derived"])).toBe("derived");
      expect(mergeIntegrity(["trusted", "untrusted"])).toBe("untrusted");
      expect(mergeIntegrity(["derived", "untrusted"])).toBe("untrusted");
      expect(mergeIntegrity(["trusted", "trusted"])).toBe("trusted");
    });

    it("returns untrusted for empty array", () => {
      expect(mergeIntegrity([])).toBe("untrusted");
    });
  });

  describe("mergeConfidentiality", () => {
    it("returns maximum confidentiality (most restrictive)", () => {
      expect(mergeConfidentiality(["public", "internal"])).toBe("internal");
      expect(mergeConfidentiality(["public", "confidential"])).toBe("confidential");
      expect(mergeConfidentiality(["internal", "confidential"])).toBe("confidential");
    });

    it("returns public for empty array", () => {
      expect(mergeConfidentiality([])).toBe("public");
    });
  });

  describe("meetsIntegrity", () => {
    it("trusted meets all requirements", () => {
      const taint = trustedTaint("test");
      expect(meetsIntegrity(taint, "trusted")).toBe(true);
      expect(meetsIntegrity(taint, "derived")).toBe(true);
      expect(meetsIntegrity(taint, "untrusted")).toBe(true);
    });

    it("derived meets derived and untrusted", () => {
      const taint = derivedTaint([trustedTaint("test")], "step");
      expect(meetsIntegrity(taint, "trusted")).toBe(false);
      expect(meetsIntegrity(taint, "derived")).toBe(true);
      expect(meetsIntegrity(taint, "untrusted")).toBe(true);
    });

    it("untrusted only meets untrusted", () => {
      const taint = userInputTaint();
      expect(meetsIntegrity(taint, "trusted")).toBe(false);
      expect(meetsIntegrity(taint, "derived")).toBe(false);
      expect(meetsIntegrity(taint, "untrusted")).toBe(true);
    });
  });

  describe("label", () => {
    it("wraps a value with taint", () => {
      const taint = userInputTaint();
      const labeled = label("hello", taint);
      expect(labeled.value).toBe("hello");
      expect(labeled.taint).toBe(taint);
    });
  });
});
