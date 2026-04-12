import { describe, it, expect, vi } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { Engine } from "./engine.js";
import { PatternRegistry } from "./registry.js";
import { PolicyEngine } from "../security/policy-engine.js";
import type { LLMProvider } from "../agents/provider.js";
import type { ExecutionPlan, LLMResponse } from "../types.js";

function mockProvider(): LLMProvider {
  const response = { content: "ok", model: "test", tokensUsed: { input: 1, output: 1 } } satisfies LLMResponse;
  return {
    complete: vi.fn().mockResolvedValue(response),
    chat: vi.fn().mockResolvedValue(response),
  };
}

function singlePlan(patternName: string): ExecutionPlan {
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

describe("Engine – Phase 5.4 Internal Pattern Dispatch", () => {
  it("dispatcht type:internal pdf_merge korrekt", async () => {
    const tmpDir = join("/tmp", `aios-int-${Date.now()}`);
    mkdirSync(join(tmpDir, "test_internal"), { recursive: true });
    writeFileSync(join(tmpDir, "test_internal", "system.md"), `---
kernel_abi: 1
name: test_internal
description: test
category: test
type: internal
internal_op: pdf_merge
input_type: file_list
input_format: txt
output_type: file
output_format: [pdf]
tags: []
---
test
`);

    // Create test PDFs to merge
    const dataDir = join(tmpDir, "data");
    mkdirSync(dataDir, { recursive: true });
    const pdf1Path = join(dataDir, "a.pdf");
    const pdf2Path = join(dataDir, "b.pdf");

    const doc1 = await PDFDocument.create();
    doc1.addPage();
    writeFileSync(pdf1Path, await doc1.save());

    const doc2 = await PDFDocument.create();
    doc2.addPage();
    writeFileSync(pdf2Path, await doc2.save());

    const registry = new PatternRegistry(tmpDir);
    const provider = mockProvider();
    const policy = new PolicyEngine([]);
    const engine = new Engine(
      registry, provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      policy,
    );

    const input = `${pdf1Path}\n${pdf2Path}`;
    const result = await engine.execute(singlePlan("test_internal"), input);
    expect(result.status.get("s1")).toBe("done");

    const msg = result.results.get("s1");
    expect(msg?.contentKind).toBe("file");
    expect(msg?.content).toContain("Datei erzeugt:");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fehlt internal_op → schlägt fehl", async () => {
    const tmpDir = join("/tmp", `aios-int-noop-${Date.now()}`);
    mkdirSync(join(tmpDir, "bad_internal"), { recursive: true });
    writeFileSync(join(tmpDir, "bad_internal", "system.md"), `---
kernel_abi: 1
name: bad_internal
description: test
category: test
type: internal
input_type: text
output_type: text
tags: []
---
test
`);

    const registry = new PatternRegistry(tmpDir);
    const provider = mockProvider();
    const engine = new Engine(registry, provider);
    const result = await engine.execute(singlePlan("bad_internal"), "input");
    expect(result.status.get("s1")).toBe("failed");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("unbekanntes internal_op → schlägt fehl", async () => {
    const tmpDir = join("/tmp", `aios-int-unk-${Date.now()}`);
    mkdirSync(join(tmpDir, "unk_internal"), { recursive: true });
    writeFileSync(join(tmpDir, "unk_internal", "system.md"), `---
kernel_abi: 1
name: unk_internal
description: test
category: test
type: internal
internal_op: does_not_exist
input_type: text
output_type: text
tags: []
---
test
`);

    const registry = new PatternRegistry(tmpDir);
    const provider = mockProvider();
    const engine = new Engine(registry, provider);
    const result = await engine.execute(singlePlan("unk_internal"), "input");
    expect(result.status.get("s1")).toBe("failed");

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
