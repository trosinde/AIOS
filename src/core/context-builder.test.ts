import { describe, it, expect } from "vitest";
import { join } from "path";
import { ContextBuilder } from "./context-builder.js";
import { PatternRegistry } from "./registry.js";
import type { StepMessage, ExecutionStep } from "../types.js";

const PATTERNS_DIR = join(process.cwd(), "patterns");

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "target",
    pattern: "summarize",
    depends_on: [],
    input_from: ["$USER_INPUT"],
    parallel_group: null,
    retry: null,
    quality_gate: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<StepMessage> = {}): StepMessage {
  return {
    source: {
      stepId: "s1",
      pattern: "security_review",
      persona: "security_expert",
      outputType: "security_findings",
    },
    content: "Vollständiger Review-Output...",
    artifacts: [],
    summary: "3 kritische Findings identifiziert",
    durationMs: 100,
    ...overrides,
  };
}

describe("ContextBuilder", () => {
  it("baut Input mit $USER_INPUT", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const builder = new ContextBuilder(registry);

    const result = builder.build(makeStep(), "Mein Input", new Map());
    expect(result).toContain("## Aufgabe");
    expect(result).toContain("Mein Input");
  });

  it("annotiert Vorgänger-Output mit Typ und Persona", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const builder = new ContextBuilder(registry);

    const messages = new Map<string, StepMessage>();
    messages.set("s1", makeMessage());

    const step = makeStep({ input_from: ["$USER_INPUT", "s1"] });
    const result = builder.build(step, "Aufgabe", messages);

    expect(result).toContain("security_findings");
    expect(result).toContain("security_expert");
    expect(result).toContain("3 kritische Findings identifiziert");
  });

  it("inkludiert Artefakte wenn vorhanden", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const builder = new ContextBuilder(registry);

    const messages = new Map<string, StepMessage>();
    messages.set(
      "s1",
      makeMessage({
        artifacts: [
          {
            type: "finding",
            id: "FIND-001",
            content: "SQL Injection in auth.ts",
            severity: "critical",
          },
          {
            type: "finding",
            id: "FIND-002",
            content: "Missing rate limiting",
            severity: "high",
          },
        ],
      }),
    );

    const step = makeStep({ input_from: ["s1"] });
    const result = builder.build(step, "", messages);

    expect(result).toContain("FIND-001");
    expect(result).toContain("[finding]");
    expect(result).toContain("[critical]");
  });

  it("funktioniert auch ohne Artefakte (graceful degradation)", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const builder = new ContextBuilder(registry);

    const messages = new Map<string, StepMessage>();
    messages.set("s1", makeMessage({ artifacts: [] }));

    const step = makeStep({ input_from: ["s1"] });
    const result = builder.build(step, "", messages);

    expect(result).not.toContain("### Artefakte");
    expect(result).toContain("### Details");
  });

  it("fügt Feedback an", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const builder = new ContextBuilder(registry);

    const result = builder.build(
      makeStep(),
      "Aufgabe",
      new Map(),
      "Fehler XY aufgetreten",
    );
    expect(result).toContain("FEEDBACK AUS VORHERIGEM VERSUCH");
    expect(result).toContain("Fehler XY");
  });

  it("buildRaw gibt nackten Content ohne Markdown-Wrapping", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const builder = new ContextBuilder(registry);

    const messages = new Map<string, StepMessage>();
    messages.set("s1", makeMessage({ content: '{"key": "value"}' }));

    const step = makeStep({ input_from: ["s1"] });
    const raw = builder.buildRaw(step, "user", messages);
    expect(raw).toBe('{"key": "value"}');
    expect(raw).not.toContain("##");
  });
});
