import { describe, it, expect, vi } from "vitest";
import { QualityPipeline } from "./pipeline.js";
import { SelfCheckPolicy, ConsistencyCheckPolicy, PeerReviewPolicy, TraceabilityCheckPolicy, QualityGatePolicy } from "./policies.js";
import type { LLMProvider } from "../../agents/provider.js";
import type { LLMResponse, QualityConfig, QualityContext, ExecutionContext, PatternMeta, KernelMessage } from "../../types.js";

function mockProvider(content = '{"pass": true, "findings": []}'): LLMProvider {
  const response: LLMResponse = {
    content,
    model: "test-model",
    tokensUsed: { input: 50, output: 100 },
  };
  return {
    complete: vi.fn().mockResolvedValue(response),
    chat: vi.fn().mockResolvedValue(response),
  };
}

function makeCtx(): ExecutionContext {
  return { trace_id: "test-trace", context_id: "default", started_at: Date.now() };
}

function makePatternMeta(overrides: Partial<PatternMeta> = {}): PatternMeta {
  return {
    name: "test_pattern",
    description: "Test pattern",
    category: "test",
    input_type: "text",
    output_type: "text",
    tags: [],
    ...overrides,
  };
}

function makeQualityConfig(overrides: Partial<QualityConfig> = {}): QualityConfig {
  return {
    level: "minimal",
    policies: {},
    ...overrides,
  };
}

describe("SelfCheckPolicy", () => {
  it("passes when LLM confirms output is good", async () => {
    const provider = mockProvider('{"pass": true, "findings": []}');
    const policy = new SelfCheckPolicy(provider);

    const result = await policy.evaluate({
      output: "A good summary",
      pattern: makePatternMeta(),
      task: "Summarize this text",
      inputUsed: "Long text...",
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(true);
    expect(result.action).toBe("continue");
    expect(result.findings).toHaveLength(0);
  });

  it("requests rework when LLM finds issues", async () => {
    const provider = mockProvider(JSON.stringify({
      pass: false,
      findings: [{ severity: "major", category: "completeness", message: "Missing key points" }],
      rework_hint: "Add more detail about the conclusion",
    }));
    const policy = new SelfCheckPolicy(provider);

    const result = await policy.evaluate({
      output: "Incomplete summary",
      pattern: makePatternMeta(),
      task: "Summarize this text",
      inputUsed: "Long text...",
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(false);
    expect(result.action).toBe("rework");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("major");
    expect(result.reworkHint).toBe("Add more detail about the conclusion");
  });

  it("gracefully handles unparseable LLM response", async () => {
    const provider = mockProvider("I cannot parse this as JSON");
    const policy = new SelfCheckPolicy(provider);

    const result = await policy.evaluate({
      output: "Some output",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(true);
    expect(result.action).toBe("continue");
    expect(result.findings[0].severity).toBe("info");
  });
});

describe("ConsistencyCheckPolicy", () => {
  it("skips when Knowledge Base is empty", async () => {
    const provider = mockProvider();
    const policy = new ConsistencyCheckPolicy(provider);

    const result = await policy.evaluate({
      output: "Some output",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(true);
    expect(result.findings[0].message).toContain("Knowledge Base is empty");
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("checks against knowledge when available", async () => {
    const provider = mockProvider('{"pass": true, "findings": [{"severity": "info", "category": "consistency", "message": "Decision DEC-001 correctly referenced"}]}');
    const policy = new ConsistencyCheckPolicy(provider);

    const result = await policy.evaluate({
      output: "Output referencing DEC-001",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      relevantDecisions: [{ content: "Use REST API", id: "DEC-001" } as KernelMessage],
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(true);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
});

describe("PeerReviewPolicy", () => {
  it("skips when no persona assigned", async () => {
    const provider = mockProvider();
    const policy = new PeerReviewPolicy(provider, () => undefined);

    const result = await policy.evaluate({
      output: "Some output",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(true);
    expect(result.findings[0].message).toContain("No persona assigned");
  });

  it("reviews with counter-persona when persona is assigned", async () => {
    const provider = mockProvider('{"pass": true, "findings": [{"severity": "minor", "category": "code_quality", "message": "Consider better error handling"}]}');
    const policy = new PeerReviewPolicy(
      provider,
      (id) => id === "reviewer" ? "You are a code reviewer" : undefined,
    );

    const result = await policy.evaluate({
      output: "Generated code",
      pattern: makePatternMeta(),
      persona: { id: "developer", name: "Dev", role: "Developer", description: "", system_prompt: "", expertise: [], preferred_patterns: [], communicates_with: [] },
      task: "Write a function",
      inputUsed: "input",
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("minor");
  });
});

describe("TraceabilityCheckPolicy", () => {
  it("skips when no requirements exist", async () => {
    const policy = new TraceabilityCheckPolicy();

    const result = await policy.evaluate({
      output: "Some output",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(true);
    expect(result.findings[0].message).toContain("No requirements");
  });

  it("blocks when requirements are not covered", async () => {
    const policy = new TraceabilityCheckPolicy(true);

    const result = await policy.evaluate({
      output: "Output mentioning REQ-001 but not the other one",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      relevantRequirements: [
        { content: "REQ-001: User login", id: "1" } as KernelMessage,
        { content: "REQ-002: User logout", id: "2" } as KernelMessage,
      ],
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(false);
    expect(result.action).toBe("block");
    expect(result.findings.some(f => f.message.includes("REQ-002"))).toBe(true);
  });

  it("passes when all requirements are referenced", async () => {
    const policy = new TraceabilityCheckPolicy(true);

    const result = await policy.evaluate({
      output: "This covers REQ-001 for login and REQ-002 for logout",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      relevantRequirements: [
        { content: "REQ-001: User login", id: "1" } as KernelMessage,
        { content: "REQ-002: User logout", id: "2" } as KernelMessage,
      ],
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});

describe("QualityGatePolicy", () => {
  it("passes when no critical findings", async () => {
    const policy = new QualityGatePolicy("critical");

    const result = await policy.evaluate({
      output: "Some output",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      previousPolicyFindings: [
        { severity: "minor", category: "style", message: "Minor issue", source: "peer_review" },
      ],
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(true);
    expect(result.action).toBe("continue");
  });

  it("blocks on critical findings", async () => {
    const policy = new QualityGatePolicy("critical");

    const result = await policy.evaluate({
      output: "Some output",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      previousPolicyFindings: [
        { severity: "critical", category: "security", message: "SQL injection vulnerability", source: "compliance_check" },
      ],
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(false);
    expect(result.action).toBe("block");
  });

  it("blocks on major findings when block_on is major", async () => {
    const policy = new QualityGatePolicy("major");

    const result = await policy.evaluate({
      output: "Some output",
      pattern: makePatternMeta(),
      task: "Some task",
      inputUsed: "input",
      previousPolicyFindings: [
        { severity: "major", category: "completeness", message: "Missing section", source: "self_check" },
      ],
      executionContext: makeCtx(),
    } as QualityContext);

    expect(result.pass).toBe(false);
    expect(result.action).toBe("block");
  });
});

describe("QualityPipeline", () => {
  it("runs self-check at minimal level", async () => {
    const provider = mockProvider('{"pass": true, "findings": []}');
    const config = makeQualityConfig({ level: "minimal" });
    const pipeline = new QualityPipeline(config, provider);

    const result = await pipeline.evaluate(
      "Good output",
      makePatternMeta(),
      "Test task",
      "Test input",
      makeCtx(),
    );

    expect(result.passed).toBe(true);
    expect(result.decision).toBe("PASSED");
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it("includes all standard policies at standard level", async () => {
    const config = makeQualityConfig({ level: "standard" });
    const provider = mockProvider('{"pass": true, "findings": []}');
    const pipeline = new QualityPipeline(config, provider);

    const policies = pipeline.getActivePolicies();
    expect(policies).toContain("self_check");
    expect(policies).toContain("consistency_check");
    expect(policies).toContain("peer_review");
  });

  it("includes all policies at regulated level", async () => {
    const config = makeQualityConfig({ level: "regulated" });
    const provider = mockProvider('{"pass": true, "findings": []}');
    const pipeline = new QualityPipeline(config, provider);

    const policies = pipeline.getActivePolicies();
    expect(policies).toContain("self_check");
    expect(policies).toContain("consistency_check");
    expect(policies).toContain("peer_review");
    expect(policies).toContain("compliance_check");
    expect(policies).toContain("traceability_check");
    expect(policies).toContain("quality_gate");
  });

  it("respects disabled policies", async () => {
    const config = makeQualityConfig({
      level: "standard",
      policies: {
        consistency_check: { enabled: false },
      },
    });
    const provider = mockProvider('{"pass": true, "findings": []}');
    const pipeline = new QualityPipeline(config, provider);

    const policies = pipeline.getActivePolicies();
    expect(policies).toContain("self_check");
    expect(policies).not.toContain("consistency_check");
    expect(policies).toContain("peer_review");
  });

  it("performs rework when self-check fails", async () => {
    const failResponse: LLMResponse = {
      content: JSON.stringify({
        pass: false,
        findings: [{ severity: "major", category: "completeness", message: "Incomplete" }],
        rework_hint: "Add more detail",
      }),
      model: "test",
      tokensUsed: { input: 50, output: 100 },
    };
    const passResponse: LLMResponse = {
      content: JSON.stringify({ pass: true, findings: [] }),
      model: "test",
      tokensUsed: { input: 50, output: 100 },
    };

    const provider = {
      complete: vi.fn()
        .mockResolvedValueOnce(failResponse)  // First self-check fails
        .mockResolvedValueOnce(passResponse), // Second self-check passes
      chat: vi.fn(),
    };

    const config = makeQualityConfig({
      level: "minimal",
      policies: { self_check: { max_retries: 1 } },
    });
    const pipeline = new QualityPipeline(config, provider);

    let rerunCalled = false;
    const result = await pipeline.evaluate(
      "Bad output",
      makePatternMeta(),
      "Test task",
      "Test input",
      makeCtx(),
      {
        rerunPattern: async (hint, prev) => {
          rerunCalled = true;
          return "Improved output";
        },
      },
    );

    expect(rerunCalled).toBe(true);
    expect(result.reworkAttempts).toBe(1);
    expect(result.output).toBe("Improved output");
    expect(result.passed).toBe(true);
  });

  it("returns PASSED_WITH_FINDINGS when no rerun function available", async () => {
    const provider = mockProvider(JSON.stringify({
      pass: false,
      findings: [{ severity: "major", category: "completeness", message: "Incomplete" }],
      rework_hint: "Add more detail",
    }));

    const config = makeQualityConfig({ level: "minimal" });
    const pipeline = new QualityPipeline(config, provider);

    const result = await pipeline.evaluate(
      "Incomplete output",
      makePatternMeta(),
      "Test task",
      "Test input",
      makeCtx(),
    );

    expect(result.passed).toBe(true);
    expect(result.decision).toBe("PASSED_WITH_FINDINGS");
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
