import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { queryService } from "./query-engine.js";
import type { ServiceEndpoint, ExecutionContext, LLMResponse } from "../types.js";
import type { LLMProvider } from "../agents/provider.js";

const TMP = join(process.cwd(), "tmp-test-query");

const EMPLOYEES = [
  { name: "Max Mustermann", personnel_number: "P-1042", department: "Engineering", email: "max@firma.de" },
  { name: "Lisa Schmidt", personnel_number: "P-1078", department: "HR", email: "lisa@firma.de" },
  { name: "Tom Müller", personnel_number: "P-1099", department: "Engineering", email: "tom@firma.de" },
];

function makeEndpoint(): ServiceEndpoint {
  return {
    name: "employees",
    description: "Mitarbeiterverzeichnis",
    context: "hr",
    data_file: "employees.json",
    fields: [
      { name: "name", type: "string" },
      { name: "personnel_number", type: "string" },
      { name: "department", type: "string" },
      { name: "email", type: "string" },
    ],
    key_fields: ["name", "personnel_number", "department"],
    record_count: 3,
    last_indexed: Date.now(),
  };
}

beforeEach(() => {
  mkdirSync(join(TMP, "data"), { recursive: true });
  writeFileSync(join(TMP, "data", "employees.json"), JSON.stringify(EMPLOYEES));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("queryService", () => {
  it("finds exact match by personnel_number", async () => {
    const result = await queryService(makeEndpoint(), { personnel_number: "P-1042" }, TMP);
    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Max Mustermann");
  });

  it("finds case-insensitive substring match by name", async () => {
    const result = await queryService(makeEndpoint(), { name: "lisa" }, TMP);
    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Lisa Schmidt");
  });

  it("finds multiple matches by department", async () => {
    const result = await queryService(makeEndpoint(), { department: "Engineering" }, TMP);
    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(2);
  });

  it("returns empty results when no match", async () => {
    const result = await queryService(makeEndpoint(), { name: "Nonexistent" }, TMP);
    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(0);
  });

  it("returns empty results when query uses non-key fields", async () => {
    const result = await queryService(makeEndpoint(), { email: "max@firma.de" }, TMP);
    // email is not in key_fields, so direct search should not match
    expect(result.results).toHaveLength(0);
  });

  it("combines multiple query fields with AND logic", async () => {
    const result = await queryService(
      makeEndpoint(),
      { name: "Max", department: "Engineering" },
      TMP,
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Max Mustermann");
  });

  it("returns correct metadata in result", async () => {
    const result = await queryService(makeEndpoint(), { name: "Lisa" }, TMP);
    expect(result.endpoint).toBe("employees");
    expect(result.context).toBe("hr");
    expect(result.query).toEqual({ name: "Lisa" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── LLM Fallback Tests ──────────────────────────────────

function makeMockProvider(responseContent: string): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: responseContent,
      model: "test-model",
      tokensUsed: { input: 100, output: 50 },
    } satisfies LLMResponse),
    chat: vi.fn().mockResolvedValue({
      content: responseContent,
      model: "test-model",
      tokensUsed: { input: 100, output: 50 },
    } satisfies LLMResponse),
  };
}

function makeCtx(): ExecutionContext {
  return {
    trace_id: "test-trace-123",
    context_id: "test-context",
    started_at: Date.now(),
  };
}

describe("queryService – LLM fallback", () => {
  beforeEach(() => {
    mkdirSync(join(TMP, "data"), { recursive: true });
    writeFileSync(join(TMP, "data", "employees.json"), JSON.stringify(EMPLOYEES));
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("uses LLM fallback when direct search finds nothing and provider is available", async () => {
    const llmResults = [{ name: "Lisa Schmidt", department: "HR" }];
    const provider = makeMockProvider(JSON.stringify(llmResults));
    const ctx = makeCtx();

    // Query with a field that is a key_field but won't match directly
    const result = await queryService(
      makeEndpoint(),
      { name: "Frau Schmidt aus der HR" },
      TMP,
      provider,
      ctx,
    );

    expect(result.method).toBe("llm");
    expect(provider.complete).toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Lisa Schmidt");
  });

  it("returns empty when LLM returns no JSON array", async () => {
    const provider = makeMockProvider("I don't know what you mean.");
    const ctx = makeCtx();

    const result = await queryService(
      makeEndpoint(),
      { name: "Nonexistent Person XYZ" },
      TMP,
      provider,
      ctx,
    );

    expect(result.method).toBe("llm");
    expect(result.results).toEqual([]);
  });

  it("returns empty when LLM returns invalid JSON", async () => {
    const provider = makeMockProvider("[{invalid json}]");
    const ctx = makeCtx();

    const result = await queryService(
      makeEndpoint(),
      { name: "Someone" },
      TMP,
      provider,
      ctx,
    );

    expect(result.method).toBe("llm");
    expect(result.results).toEqual([]);
  });

  it("returns empty (direct, no LLM) when no match and no provider", async () => {
    const result = await queryService(
      makeEndpoint(),
      { name: "Nobody" },
      TMP,
      undefined,
      undefined,
    );

    expect(result.method).toBe("direct");
    expect(result.results).toEqual([]);
  });

  it("filters out non-object items from LLM response", async () => {
    // LLM returns a mix of valid objects and invalid items
    const provider = makeMockProvider('[{"name": "Max"}, null, "string", 42, [1,2]]');
    const ctx = makeCtx();

    const result = await queryService(
      makeEndpoint(),
      { name: "Wer arbeitet hier?" },
      TMP,
      provider,
      ctx,
    );

    expect(result.method).toBe("llm");
    // Only the valid object should survive
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({ name: "Max" });
  });

  it("prefers direct match over LLM — does not call provider when direct hit exists", async () => {
    const provider = makeMockProvider("[]");
    const ctx = makeCtx();

    const result = await queryService(
      makeEndpoint(),
      { name: "Lisa" },
      TMP,
      provider,
      ctx,
    );

    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(1);
    // Provider should NOT have been called
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("extracts JSON array embedded in surrounding text", async () => {
    const provider = makeMockProvider(
      'Here are the results:\n[{"name": "Tom Müller", "department": "Engineering"}]\nHope this helps!',
    );
    const ctx = makeCtx();

    const result = await queryService(
      makeEndpoint(),
      { name: "Ingenieur gesucht" },
      TMP,
      provider,
      ctx,
    );

    expect(result.method).toBe("llm");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Tom Müller");
  });
});
