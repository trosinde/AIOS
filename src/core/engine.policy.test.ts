import { describe, it, expect, vi } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { Engine } from "./engine.js";
import { PatternRegistry } from "./registry.js";
import { DriverRegistry } from "./driver-registry.js";
import { PolicyEngine, DEFAULT_POLICIES } from "../security/policy-engine.js";
import { AuditLogger } from "../security/audit-logger.js";
import type { LLMProvider } from "../agents/provider.js";
import type { ExecutionPlan, LLMResponse, AiosConfig } from "../types.js";

const PATTERNS_DIR = join(process.cwd(), "patterns");

function mockProvider(content = "ok"): LLMProvider {
  const response = { content, model: "test", tokensUsed: { input: 1, output: 1 } } satisfies LLMResponse;
  return {
    complete: vi.fn().mockResolvedValue(response),
    chat: vi.fn().mockResolvedValue(response),
  };
}

function singlePatternPlan(patternName: string): ExecutionPlan {
  return {
    analysis: { goal: "t", complexity: "low", requires_compliance: false, disciplines: [] },
    plan: {
      type: "pipe",
      steps: [{
        id: "s1",
        pattern: patternName,
        depends_on: [],
        input_from: ["$USER_INPUT"],
        parallel_group: null,
        retry: null,
        quality_gate: null,
      }],
    },
    reasoning: "t",
  };
}

describe("Engine – Phase 5.3 PolicyEngine integration", () => {
  it("Tool-Pattern wird bei strict DEFAULT_POLICIES + untrusted Input geblockt", async () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider();
    const audit = new AuditLogger({ enabled: false, logFile: "/tmp/x.jsonl", logLevel: "error", complianceReports: false });
    const policy = new PolicyEngine(DEFAULT_POLICIES, audit);
    const engine = new Engine(
      registry, provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      policy, audit,
    );
    const result = await engine.execute(singlePatternPlan("render_diagram"), "graph TD; A-->B");
    expect(result.status.get("s1")).toBe("failed");
  });

  it("Tool-Pattern läuft mit leerem Policy-Set durch (CLI-Default)", async () => {
    // render_diagram braucht echtes mmdc, also nehmen wir summarize (LLM-Pattern)
    const registry = new PatternRegistry(PATTERNS_DIR);
    const provider = mockProvider("ok");
    const audit = new AuditLogger({ enabled: false, logFile: "/tmp/x.jsonl", logLevel: "error", complianceReports: false });
    const policy = new PolicyEngine([], audit);
    const engine = new Engine(
      registry, provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      policy, audit,
    );
    const result = await engine.execute(singlePatternPlan("summarize"), "text");
    expect(result.status.get("s1")).toBe("done");
  });

  it("compliance_tags blockt Pattern wenn Context den Tag nicht bietet", async () => {
    // Wir patchen ein Pattern in eine temp-Registry mit compliance_tags
    const tmpDir = join("/tmp", `aios-policy-${crypto.randomUUID()}`);
    mkdirSync(join(tmpDir, "regulated_pattern"), { recursive: true });
    writeFileSync(join(tmpDir, "regulated_pattern", "system.md"), `---
kernel_abi: 1
name: regulated_pattern
description: needs cra
category: test
input_type: text
output_type: text
tags: []
compliance_tags: [cra]
---
You are a test.
`);

    const registry = new PatternRegistry(tmpDir);
    const provider = mockProvider("ok");
    const policy = new PolicyEngine([]);  // leer, nur compliance_tags geprüft
    const engine = new Engine(
      registry, provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      policy,
    );
    const result = await engine.execute(singlePatternPlan("regulated_pattern"), "text");
    expect(result.status.get("s1")).toBe("failed");

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("Engine – Phase 5.3 Driver capability + sandbox", () => {
  let repo: string;
  let driverRegistry: DriverRegistry;

  function setup(driverYaml: string): void {
    repo = join("/tmp", `aios-cap-${crypto.randomUUID()}`);
    mkdirSync(join(repo, "drivers", "fakedriver"), { recursive: true });
    writeFileSync(join(repo, "drivers", "fakedriver", "driver.yaml"), driverYaml);
    driverRegistry = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
  }

  function teardown(): void {
    rmSync(repo, { recursive: true, force: true });
  }

  it("blockt Driver mit Capability network im Default-Context", async () => {
    setup(`
kernel_abi: 1
name: fakedriver
binary: /bin/true
capabilities: [file_read, network]
operations:
  noop:
    inputs:
      src:
        type: file
        ext: [txt]
    outputs:
      out:
        type: file
        ext: [txt]
    argv: ["$src"]
sandbox:
  timeout_sec: 5
`);

    // Pattern-Registry mit einem Pattern das diesen Driver nutzt
    const tmpPatterns = join("/tmp", `aios-cap-pat-${crypto.randomUUID()}`);
    mkdirSync(join(tmpPatterns, "fake_pat"), { recursive: true });
    writeFileSync(join(tmpPatterns, "fake_pat", "system.md"), `---
kernel_abi: 1
name: fake_pat
description: fake
category: test
input_type: text
output_type: file
tags: []
type: tool
driver: fakedriver
operation: noop
input_format: txt
output_format: [txt]
---
fake
`);

    const registry = new PatternRegistry(tmpPatterns);
    const provider = mockProvider();
    const policy = new PolicyEngine([]);
    const engine = new Engine(
      registry, provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      driverRegistry, policy,
    );
    const result = await engine.execute(singlePatternPlan("fake_pat"), "hello");
    expect(result.status.get("s1")).toBe("failed");

    rmSync(tmpPatterns, { recursive: true, force: true });
    teardown();
  });
});
