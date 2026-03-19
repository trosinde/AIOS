import { describe, it, expect } from "vitest";
import { PromptBuilder } from "./prompt-builder.js";
import { trustedTaint, userInputTaint } from "./taint-tracker.js";

describe("PromptBuilder", () => {
  const builder = new PromptBuilder();

  describe("build", () => {
    it("includes pattern prompt in system prompt", () => {
      const result = builder.build("You are a summarizer.", "Summarize this text.");
      expect(result.systemPrompt).toContain("You are a summarizer.");
    });

    it("includes security rules when instructionHierarchy enabled", () => {
      const result = builder.build("Pattern prompt.", "User input.");
      expect(result.systemPrompt).toContain("SECURITY RULES");
      expect(result.systemPrompt).toContain("user_data");
    });

    it("generates canary token when enabled", () => {
      const result = builder.build("Pattern.", "Input.", [], "trace-1");
      expect(result.canary).not.toBeNull();
      expect(result.systemPrompt).toContain("CANARY-");
      expect(result.systemPrompt).toContain("INTEGRITY CHECK");
    });

    it("wraps user input in data tags", () => {
      const result = builder.build("Pattern.", "Dangerous user input.");
      // One of the delimiter variants should be present
      expect(result.userMessage).toContain("Dangerous user input.");
      // Check that some form of data tagging wraps it
      const hasTag = result.userMessage.includes("user_data") ||
        result.userMessage.includes("USER_DATA") ||
        result.userMessage.includes("UNTRUSTED DATA") ||
        result.userMessage.includes("user input");
      expect(hasTag).toBe(true);
    });

    it("tags trusted context appropriately", () => {
      const result = builder.build("Pattern.", "Input.", [
        { source: "knowledge_base", content: "Known fact.", taint: trustedTaint("kb") },
      ]);
      expect(result.userMessage).toContain("trusted_context");
      expect(result.userMessage).toContain("Known fact.");
    });

    it("tags untrusted context appropriately", () => {
      const result = builder.build("Pattern.", "Input.", [
        { source: "previous_step", content: "Step output.", taint: userInputTaint() },
      ]);
      expect(result.userMessage).toContain("context");
      expect(result.userMessage).toContain("untrusted");
    });

    it("escapes HTML entities in source attributes", () => {
      const result = builder.build("Pattern.", "Input.", [
        { source: 'step"with<special>&chars', content: "Content." },
      ]);
      expect(result.userMessage).not.toContain('"with<special>');
      expect(result.userMessage).toContain("&lt;");
    });
  });

  describe("buildRouterPrompt", () => {
    it("includes router system prompt", () => {
      const result = builder.buildRouterPrompt("Router system.", "Task.", "Pattern catalog.");
      expect(result.systemPrompt).toContain("Router system.");
    });

    it("includes security rules for router", () => {
      const result = builder.buildRouterPrompt("Router.", "Task.", "Catalog.");
      expect(result.systemPrompt).toContain("workflow planner");
      expect(result.systemPrompt).toContain("ONLY");
    });

    it("includes task and catalog in user message", () => {
      const result = builder.buildRouterPrompt("Router.", "My task.", "Pattern list.");
      expect(result.userMessage).toContain("My task.");
      expect(result.userMessage).toContain("Pattern list.");
    });

    it("has no canary (router returns JSON)", () => {
      const result = builder.buildRouterPrompt("Router.", "Task.", "Catalog.");
      expect(result.canary).toBeNull();
    });

    it("includes project context when provided", () => {
      const result = builder.buildRouterPrompt("Router.", "Task.", "Catalog.", "Medical device project");
      expect(result.userMessage).toContain("Medical device project");
    });
  });

  describe("disabled features", () => {
    it("omits security rules when instructionHierarchy disabled", () => {
      const b = new PromptBuilder({ instructionHierarchy: false });
      const result = b.build("Pattern.", "Input.");
      expect(result.systemPrompt).not.toContain("SECURITY RULES");
    });

    it("omits canary when canaryTokens disabled", () => {
      const b = new PromptBuilder({ canaryTokens: false });
      const result = b.build("Pattern.", "Input.");
      expect(result.canary).toBeNull();
      expect(result.systemPrompt).not.toContain("CANARY");
    });

    it("omits data tags when dataTagging disabled", () => {
      const b = new PromptBuilder({ dataTagging: false });
      const result = b.build("Pattern.", "The user input.");
      expect(result.userMessage).toContain("The user input.");
      expect(result.userMessage).not.toContain("user_data");
      expect(result.userMessage).not.toContain("USER_DATA");
    });
  });
});
