/**
 * Tests for the shared Engine factory.
 *
 * The critical invariants:
 *   - unattended: true → ExecutionContext has interactive=false + max_write_steps
 *   - unattended: true → PolicyEngine runs strict regardless of context config
 *   - unattended: false → attended defaults (interactive=true, relaxed policy fallback)
 *   - CircuitBreaker is enabled in unattended mode (via fromContext)
 *
 * These are the guarantees the MCP server depends on.
 */
import { describe, it, expect, vi } from "vitest";
import { join } from "path";
import { PatternRegistry } from "./registry.js";
import { PersonaRegistry } from "./personas.js";
import { buildEngineContext } from "./engine-factory.js";
import { DEFAULT_POLICIES } from "../security/policy-engine.js";
import type { LLMProvider } from "../agents/provider.js";
import type { AiosConfig, LLMResponse } from "../types.js";

const PATTERNS_DIR = join(process.cwd(), "patterns");
const PERSONAS_DIR = join(process.cwd(), "personas");

function mockProvider(): LLMProvider {
  const response: LLMResponse = {
    content: "ok",
    model: "mock",
    tokensUsed: { input: 1, output: 1 },
  };
  return {
    complete: vi.fn().mockResolvedValue(response),
    chat: vi.fn().mockResolvedValue(response),
  };
}

function minimalConfig(): AiosConfig {
  return {
    providers: {
      mock: { type: "ollama" as const, model: "mock", endpoint: "http://localhost:11434" },
    },
    defaults: { provider: "mock" },
    paths: { patterns: PATTERNS_DIR, personas: PERSONAS_DIR },
    tools: { output_dir: "./output", allowed: [] },
  };
}

describe("buildEngineContext — unattended defaults", () => {
  it("unattended=true seeds ExecutionContext with interactive=false + max_write_steps=25", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const personas = new PersonaRegistry(PERSONAS_DIR);
    const built = buildEngineContext({
      config: minimalConfig(),
      registry,
      provider: mockProvider(),
      personas,
      unattended: true,
    });
    // Engine reads executionContextDefaults — we verify via the private field shape.
    // Cast to access private fields in test only.
    const ec = (built.engine as unknown as {
      executionContextDefaults: { interactive?: boolean; max_write_steps?: number };
    }).executionContextDefaults;
    expect(ec.interactive).toBe(false);
    expect(ec.max_write_steps).toBe(25);
  });

  it("unattended=true respects maxWriteSteps override", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const personas = new PersonaRegistry(PERSONAS_DIR);
    const built = buildEngineContext({
      config: minimalConfig(),
      registry,
      provider: mockProvider(),
      personas,
      unattended: true,
      maxWriteSteps: 5,
    });
    const ec = (built.engine as unknown as {
      executionContextDefaults: { max_write_steps?: number };
    }).executionContextDefaults;
    expect(ec.max_write_steps).toBe(5);
  });

  it("unattended=false does not seed interactive flag (attended default = true)", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const personas = new PersonaRegistry(PERSONAS_DIR);
    const built = buildEngineContext({
      config: minimalConfig(),
      registry,
      provider: mockProvider(),
      personas,
      unattended: false,
    });
    const ec = (built.engine as unknown as {
      executionContextDefaults: Record<string, unknown>;
    }).executionContextDefaults;
    // Attended mode does not override interactive or max_write_steps.
    expect(ec.interactive).toBeUndefined();
    expect(ec.max_write_steps).toBeUndefined();
  });

  it("unattended=true enables CircuitBreaker regardless of caller", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const personas = new PersonaRegistry(PERSONAS_DIR);
    const built = buildEngineContext({
      config: minimalConfig(),
      registry,
      provider: mockProvider(),
      personas,
      unattended: true,
    });
    const breaker = (built.engine as unknown as {
      circuitBreaker: { config: { enabled: boolean; maxWriteSteps: number } };
    }).circuitBreaker;
    expect(breaker.config.enabled).toBe(true);
    expect(breaker.config.maxWriteSteps).toBe(25);
  });

  it("unattended=true + single-step plan fires audit events (MCP aios_run path)", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const personas = new PersonaRegistry(PERSONAS_DIR);
    const built = buildEngineContext({
      config: minimalConfig(),
      registry,
      provider: mockProvider(),
      personas,
      unattended: true,
    });
    const inputReceivedSpy = vi.spyOn(built.auditLogger, "inputReceived");
    const planCreatedSpy = vi.spyOn(built.auditLogger, "planCreated");
    const stepExecutedSpy = vi.spyOn(built.auditLogger, "stepExecuted");

    const plan = {
      analysis: { goal: "test", complexity: "low" as const, requires_compliance: false, disciplines: [] },
      plan: {
        type: "pipe" as const,
        steps: [{ id: "run", pattern: "summarize", depends_on: [], input_from: ["$USER_INPUT"] }],
      },
      reasoning: "MCP aios_run",
    };
    await built.engine.execute(plan, "Test input for MCP aios_run");

    expect(inputReceivedSpy).toHaveBeenCalledOnce();
    expect(planCreatedSpy).toHaveBeenCalledOnce();
    expect(stepExecutedSpy).toHaveBeenCalled();
  });

  it("unattended=true activates strict policies (DEFAULT_POLICIES) on the PolicyEngine", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const personas = new PersonaRegistry(PERSONAS_DIR);
    const built = buildEngineContext({
      config: minimalConfig(),
      registry,
      provider: mockProvider(),
      personas,
      unattended: true,
    });
    const policies = (built.engine as unknown as {
      policyEngine: { getPolicies: () => { action: string }[] };
    }).policyEngine.getPolicies();
    const actions = new Set(policies.map((p) => p.action));
    // Strict mode must include at least the integrity guards from DEFAULT_POLICIES.
    const defaultActions = new Set(DEFAULT_POLICIES.map((p) => p.action));
    for (const a of defaultActions) expect(actions.has(a)).toBe(true);
  });
});
