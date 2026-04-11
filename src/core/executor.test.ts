import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { StepExecutor, classifyError } from "./executor.js";
import { CapabilityProviderSelector } from "../agents/selector.js";
import { ExecutionMemory } from "../memory/execution-memory.js";
import type {
  ProviderConfig,
  Pattern,
  EscalationConfig,
  ExecutionContext,
} from "../types.js";

// ─── Mock the provider factory so we don't make real LLM calls ──────────

const completeMock = vi.fn();

vi.mock("../agents/provider.js", () => ({
  createProvider: () => ({
    complete: (...args: unknown[]) => completeMock(...args),
    chat: vi.fn(),
  }),
}));

function caps(overrides: Partial<ProviderConfig["model_capabilities"]> = {}) {
  return {
    reasoning: 5,
    code_generation: 5,
    instruction_following: 5,
    structured_output: 5,
    language: ["en"],
    max_context: 32000,
    ...overrides,
  };
}

function tier(t: number) {
  return { tier: t, input_per_mtok: 0, output_per_mtok: 0 };
}

function makePattern(name = "summarize"): Pattern {
  return {
    meta: {
      name,
      description: "",
      category: "transform",
      input_type: "text",
      output_type: "text",
      tags: [],
      requires: { reasoning: 5, instruction_following: 5 },
    },
    systemPrompt: "Test prompt",
    filePath: `/fake/${name}/system.md`,
  };
}

function makeCtx(): ExecutionContext {
  return { trace_id: "trace-1", context_id: "test", started_at: Date.now() };
}

const NO_COOLDOWN: EscalationConfig = {
  maxRetries: 2,
  strategy: "upgrade_on_fail",
  retrySameTierFirst: true,
  cooldownMs: 0,
};

describe("StepExecutor", () => {
  let dir: string;
  let memory: ExecutionMemory;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aios-exec-"));
    memory = new ExecutionMemory(join(dir, "memory.json"));
    completeMock.mockReset();
  });

  it("success on first attempt logs success and returns response", async () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: { type: "ollama", model: "m1", model_capabilities: caps(), cost: tier(1) },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const executor = new StepExecutor(selector, memory, NO_COOLDOWN);

    completeMock.mockResolvedValueOnce({
      content: "ok",
      model: "m1",
      tokensUsed: { input: 10, output: 5 },
    });

    const result = await executor.execute(makePattern(), "input", {
      stepId: "s1",
      workflowId: "wf1",
      execCtx: makeCtx(),
    });

    expect(result.response.content).toBe("ok");
    expect(result.attempt).toBe(1);
    expect(result.provider).toBe("cheap");
    expect(completeMock).toHaveBeenCalledTimes(1);

    const stats = memory.getStats("summarize");
    expect(stats[0].successRate).toBe(100);
  });

  it("retries on same provider when retrySameTierFirst=true", async () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: { type: "ollama", model: "m1", model_capabilities: caps(), cost: tier(1) },
      expensive: {
        type: "anthropic",
        model: "m2",
        model_capabilities: caps(),
        cost: tier(3),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const executor = new StepExecutor(selector, memory, NO_COOLDOWN);

    completeMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        content: "ok",
        model: "m1",
        tokensUsed: { input: 10, output: 5 },
      });

    const result = await executor.execute(makePattern(), "input", {
      stepId: "s1",
      workflowId: "wf1",
      execCtx: makeCtx(),
    });

    expect(result.attempt).toBe(2);
    expect(result.provider).toBe("cheap"); // Still cheap on retry 1
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("escalates to more expensive provider after retry", async () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: { type: "ollama", model: "m1", model_capabilities: caps(), cost: tier(1) },
      expensive: {
        type: "anthropic",
        model: "m2",
        model_capabilities: caps(),
        cost: tier(3),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const executor = new StepExecutor(selector, memory, NO_COOLDOWN);

    completeMock
      .mockRejectedValueOnce(new Error("boom 1")) // cheap, attempt 1
      .mockRejectedValueOnce(new Error("boom 2")) // cheap, attempt 2 (same tier retry)
      .mockResolvedValueOnce({
        content: "ok",
        model: "m2",
        tokensUsed: { input: 10, output: 5 },
      }); // expensive, attempt 3

    // Need maxRetries=2 so total attempts=3
    const result = await executor.execute(makePattern(), "input", {
      stepId: "s1",
      workflowId: "wf1",
      execCtx: makeCtx(),
    });

    expect(result.attempt).toBe(3);
    expect(result.provider).toBe("expensive");
    expect(result.escalationPath[result.escalationPath.length - 1]).toBe("expensive");
    expect(completeMock).toHaveBeenCalledTimes(3);
  });

  it("throws after all retries exhausted and logs failure", async () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: { type: "ollama", model: "m1", model_capabilities: caps(), cost: tier(1) },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const executor = new StepExecutor(selector, memory, {
      ...NO_COOLDOWN,
      maxRetries: 1,
    });

    completeMock.mockRejectedValue(new Error("persistent"));

    await expect(
      executor.execute(makePattern(), "input", {
        stepId: "s1",
        workflowId: "wf1",
        execCtx: makeCtx(),
      }),
    ).rejects.toThrow(/after 2 attempts/);

    expect(completeMock).toHaveBeenCalledTimes(2);

    // Only the first attempt counts toward stats
    const stats = memory.getStats("summarize");
    expect(stats[0].totalRuns).toBe(1);
    expect(stats[0].successRate).toBe(0);
  });

  it("fail_fast strategy does not retry", async () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: { type: "ollama", model: "m1", model_capabilities: caps(), cost: tier(1) },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const executor = new StepExecutor(selector, memory, {
      maxRetries: 0,
      strategy: "fail_fast",
      retrySameTierFirst: false,
      cooldownMs: 0,
    });

    completeMock.mockRejectedValueOnce(new Error("nope"));

    await expect(
      executor.execute(makePattern(), "input", {
        stepId: "s1",
        workflowId: "wf1",
        execCtx: makeCtx(),
      }),
    ).rejects.toThrow();

    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("escalation path is recorded in result", async () => {
    const providers: Record<string, ProviderConfig> = {
      cheap: { type: "ollama", model: "m1", model_capabilities: caps(), cost: tier(1) },
      expensive: {
        type: "anthropic",
        model: "m2",
        model_capabilities: caps(),
        cost: tier(3),
      },
    };
    const selector = new CapabilityProviderSelector(providers, memory);
    const executor = new StepExecutor(selector, memory, NO_COOLDOWN);

    completeMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        content: "ok",
        model: "m2",
        tokensUsed: { input: 10, output: 5 },
      });

    const result = await executor.execute(makePattern(), "input", {
      stepId: "s1",
      workflowId: "wf1",
      execCtx: makeCtx(),
    });

    expect(result.escalationPath).toEqual(["cheap", "cheap", "expensive"]);
  });

  it("cleans up memory dir", () => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("classifyError", () => {
  it("detects invalid_json", () => {
    expect(classifyError(new Error("JSON parse failed"))).toBe("invalid_json");
  });
  it("detects timeout", () => {
    expect(classifyError(new Error("request timed out"))).toBe("timeout");
  });
  it("detects rate_limit", () => {
    expect(classifyError(new Error("HTTP 429 rate limit"))).toBe("rate_limit");
  });
  it("detects auth_error", () => {
    expect(classifyError(new Error("401 Unauthorized"))).toBe("auth_error");
  });
  it("detects connection_error", () => {
    expect(classifyError(new Error("ECONNREFUSED"))).toBe("connection_error");
  });
  it("returns unknown for unrecognised errors", () => {
    expect(classifyError(new Error("weird thing"))).toBe("unknown");
  });
});
