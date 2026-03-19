import { describe, it, expect } from "vitest";
import { generateCanary, checkCanary, stripCanary } from "./canary.js";

describe("CanarySystem", () => {
  describe("generateCanary", () => {
    it("generates a canary with unique token", () => {
      const canary = generateCanary("trace-1");
      expect(canary.token).toMatch(/^CANARY-[a-f0-9]{12}$/);
      expect(canary.instruction).toContain(canary.token);
      expect(canary.instruction).toContain("INTEGRITY CHECK");
    });

    it("generates different canaries for different traces", () => {
      const c1 = generateCanary("trace-1");
      const c2 = generateCanary("trace-2");
      expect(c1.token).not.toBe(c2.token);
    });

    it("generates different canaries even with same trace", () => {
      const c1 = generateCanary("same-trace");
      const c2 = generateCanary("same-trace");
      // Random bytes ensure uniqueness
      expect(c1.token).not.toBe(c2.token);
    });
  });

  describe("checkCanary", () => {
    it("detects present canary", () => {
      const canary = generateCanary("trace-1");
      const output = `Here is my response.\n\n${canary.token}`;
      const result = checkCanary(output, canary);
      expect(result.present).toBe(true);
      expect(result.modified).toBe(false);
    });

    it("detects missing canary", () => {
      const canary = generateCanary("trace-1");
      const output = "Here is my response without any canary.";
      const result = checkCanary(output, canary);
      expect(result.present).toBe(false);
      expect(result.modified).toBe(false);
    });

    it("detects modified canary", () => {
      const canary = generateCanary("trace-1");
      const output = `Here is my response.\n\nCANARY-000000000000`;
      const result = checkCanary(output, canary);
      expect(result.present).toBe(false);
      expect(result.modified).toBe(true);
    });
  });

  describe("stripCanary", () => {
    it("removes canary token from output", () => {
      const canary = generateCanary("trace-1");
      const output = `Here is my response.\n\n${canary.token}`;
      const stripped = stripCanary(output, canary);
      expect(stripped).toBe("Here is my response.");
      expect(stripped).not.toContain("CANARY-");
    });

    it("handles output without canary gracefully", () => {
      const canary = generateCanary("trace-1");
      const output = "No canary here.";
      const stripped = stripCanary(output, canary);
      expect(stripped).toBe("No canary here.");
    });
  });
});
