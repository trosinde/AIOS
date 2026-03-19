import { describe, it, expect } from "vitest";
import { KnowledgeGuard } from "./knowledge-guard.js";
import { PolicyEngine } from "./policy-engine.js";
import { userInputTaint, trustedTaint, derivedTaint } from "./taint-tracker.js";
import type { KnowledgeWriteRequest } from "./knowledge-guard.js";

const makeRequest = (integrity: "trusted" | "derived" | "untrusted"): KnowledgeWriteRequest => {
  const taintFn = integrity === "trusted"
    ? () => trustedTaint("test")
    : integrity === "derived"
      ? () => derivedTaint([trustedTaint("test")], "llm_step")
      : () => userInputTaint();

  return {
    content: "Test knowledge entry",
    type: "fact",
    tags: ["test"],
    sourcePattern: "test_pattern",
    taint: taintFn(),
  };
};

describe("KnowledgeGuard", () => {
  describe("validateWrite", () => {
    it("allows trusted writes immediately", () => {
      const guard = new KnowledgeGuard();
      const result = guard.validateWrite(makeRequest("trusted"));
      expect(result.decision).toBe("allow");
    });

    it("queues derived writes for review", () => {
      const guard = new KnowledgeGuard({ autoReview: true });
      const result = guard.validateWrite(makeRequest("derived"));
      expect(result.decision).toBe("queue_for_review");
      expect(result.reviewId).toBeDefined();
    });

    it("allows derived writes when autoReview disabled", () => {
      const guard = new KnowledgeGuard({ autoReview: false });
      const result = guard.validateWrite(makeRequest("derived"));
      expect(result.decision).toBe("allow");
    });

    it("blocks untrusted writes", () => {
      const guard = new KnowledgeGuard();
      const result = guard.validateWrite(makeRequest("untrusted"));
      expect(result.decision).toBe("block");
    });

    it("blocks writes that violate policy engine", () => {
      const policy = new PolicyEngine();
      const guard = new KnowledgeGuard({}, policy);
      const result = guard.validateWrite(makeRequest("untrusted"));
      expect(result.decision).toBe("block");
    });
  });

  describe("Review Queue", () => {
    it("adds items to review queue", () => {
      const guard = new KnowledgeGuard({ autoReview: true });
      guard.validateWrite(makeRequest("derived"));
      guard.validateWrite(makeRequest("derived"));
      expect(guard.getReviewQueue()).toHaveLength(2);
    });

    it("approves review items (promotes to trusted)", () => {
      const guard = new KnowledgeGuard({ autoReview: true });
      const writeResult = guard.validateWrite(makeRequest("derived"));
      const approved = guard.approveReview(writeResult.reviewId!);
      expect(approved).not.toBeNull();
      expect(approved!.taint.integrity).toBe("trusted");
      expect(approved!.taint.transformations).toContain("human_review");
      expect(guard.getReviewQueue()).toHaveLength(0);
    });

    it("rejects review items", () => {
      const guard = new KnowledgeGuard({ autoReview: true });
      const writeResult = guard.validateWrite(makeRequest("derived"));
      const rejected = guard.rejectReview(writeResult.reviewId!);
      expect(rejected).toBe(true);
      expect(guard.getReviewQueue()).toHaveLength(0);
    });

    it("returns null for non-existent review ID", () => {
      const guard = new KnowledgeGuard();
      expect(guard.approveReview("nonexistent")).toBeNull();
      expect(guard.rejectReview("nonexistent")).toBe(false);
    });
  });

  describe("tagForInjection", () => {
    it("returns content unchanged for trusted data", () => {
      const guard = new KnowledgeGuard();
      const tagged = guard.tagForInjection("Known fact.", trustedTaint("test"));
      expect(tagged).toBe("Known fact.");
    });

    it("wraps derived data with integrity warning", () => {
      const guard = new KnowledgeGuard();
      const taint = derivedTaint([trustedTaint("test")], "step");
      const tagged = guard.tagForInjection("Derived fact.", taint);
      expect(tagged).toContain("<knowledge");
      expect(tagged).toContain("derived");
      expect(tagged).toContain("WARNING");
      expect(tagged).toContain("Derived fact.");
    });

    it("wraps untrusted data with integrity warning", () => {
      const guard = new KnowledgeGuard();
      const tagged = guard.tagForInjection("User claim.", userInputTaint());
      expect(tagged).toContain("<knowledge");
      expect(tagged).toContain("untrusted");
    });
  });

  describe("buildProvenance", () => {
    it("creates provenance entry with all metadata", () => {
      const guard = new KnowledgeGuard();
      const request = makeRequest("derived");
      const prov = guard.buildProvenance(request, "trace-123");
      expect(prov.sourcePattern).toBe("test_pattern");
      expect(prov.traceId).toBe("trace-123");
      expect(prov.taint.integrity).toBe("derived");
      expect(prov.timestamp).toBeGreaterThan(0);
    });
  });
});
