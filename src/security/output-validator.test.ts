import { describe, it, expect } from "vitest";
import { OutputValidator } from "./output-validator.js";
import { generateCanary } from "./canary.js";

describe("OutputValidator", () => {
  const validator = new OutputValidator();

  describe("Canary Check", () => {
    it("validates output with correct canary", () => {
      const canary = generateCanary("trace-1");
      const output = `Here is my response.\n\n${canary.token}`;
      const result = validator.validate(output, canary, "text", "summarize");
      expect(result.valid).toBe(true);
      expect(result.cleanOutput).not.toContain("CANARY-");
    });

    it("flags missing canary as critical", () => {
      const canary = generateCanary("trace-1");
      const output = "Response without canary.";
      const result = validator.validate(output, canary, "text", "summarize");
      expect(result.issues.some((i) => i.type === "canary_missing")).toBe(true);
      expect(result.issues.some((i) => i.severity === "critical")).toBe(true);
    });

    it("flags modified canary as high severity", () => {
      const canary = generateCanary("trace-1");
      const output = `Response with wrong CANARY-000000000000`;
      const result = validator.validate(output, canary, "text", "summarize");
      expect(result.issues.some((i) => i.type === "canary_modified")).toBe(true);
    });

    it("skips canary check when no canary provided", () => {
      const result = validator.validate("Any output.", null, "text");
      expect(result.valid).toBe(true);
    });
  });

  describe("Schema Validation", () => {
    it("validates JSON output", () => {
      const result = validator.validate('{"key": "value"}', null, "json");
      expect(result.issues.filter((i) => i.type === "schema_mismatch")).toHaveLength(0);
    });

    it("flags non-JSON output when JSON expected", () => {
      const result = validator.validate("Not JSON at all.", null, "json");
      expect(result.issues.some((i) => i.type === "schema_mismatch")).toBe(true);
    });

    it("accepts JSON in markdown fences", () => {
      const output = "```json\n{\"key\": \"value\"}\n```";
      const result = validator.validate(output, null, "json");
      expect(result.issues.filter((i) => i.type === "schema_mismatch")).toHaveLength(0);
    });

    it("validates mermaid output", () => {
      const result = validator.validate("graph TD\nA-->B", null, "mermaid");
      expect(result.issues.filter((i) => i.type === "schema_mismatch")).toHaveLength(0);
    });

    it("accepts text/markdown output types", () => {
      const result = validator.validate("Any text.", null, "text");
      expect(result.issues.filter((i) => i.type === "schema_mismatch")).toHaveLength(0);
    });
  });

  describe("Exfiltration Detection", () => {
    it("detects suspicious URLs with sensitive params", () => {
      const output = "Visit https://evil.com/collect?api_key=abc123 for more info";
      const result = validator.validate(output, null);
      expect(result.issues.some((i) => i.type === "exfiltration_attempt")).toBe(true);
    });

    it("detects large base64 blocks", () => {
      const largeBase64 = "A".repeat(200);
      const output = `Here is encoded data: ${largeBase64}`;
      const result = validator.validate(output, null);
      expect(result.issues.some((i) => i.type === "exfiltration_attempt")).toBe(true);
    });

    it("does not flag normal output", () => {
      const output = "The quarterly revenue was $10M, showing 15% growth over Q2.";
      const result = validator.validate(output, null);
      expect(result.issues.filter((i) => i.type === "exfiltration_attempt")).toHaveLength(0);
    });
  });

  describe("Length Anomaly", () => {
    it("flags excessively long output", () => {
      const validator = new OutputValidator({ maxOutputLength: 100 });
      const output = "x".repeat(200);
      const result = validator.validate(output, null);
      expect(result.issues.some((i) => i.type === "anomaly")).toBe(true);
    });
  });
});
