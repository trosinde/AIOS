import { describe, it, expect } from "vitest";
import {
  extractRecallPlan,
  parseSearchResponse,
  groupDrawers,
  formatContextBlock,
  type Drawer,
  type RecallResult,
  type SearchQuery,
} from "./mempalace-recall.js";

describe("extractRecallPlan", () => {
  it("parses plain JSON with search_queries", () => {
    const input = JSON.stringify({
      search_queries: [
        { query: "OAuth2 flows", rationale: "authn" },
        { query: "rate limiting", wing: "wing_aios", room: "api" },
      ],
      context_block: "## Bekannte Entscheidungen\n…",
    });
    const plan = extractRecallPlan(input);
    expect(plan.search_queries).toHaveLength(2);
    expect(plan.search_queries[0].query).toBe("OAuth2 flows");
    expect(plan.search_queries[1].wing).toBe("wing_aios");
    expect(plan.search_queries[1].room).toBe("api");
  });

  it("handles ContextBuilder-wrapped markdown", () => {
    const input = [
      "## context (von memory_recall)",
      "> Zusammenfassung: 3 queries",
      "### Details",
      "",
      "```json",
      JSON.stringify({ search_queries: [{ query: "kernel abi" }] }),
      "```",
    ].join("\n");
    const plan = extractRecallPlan(input);
    expect(plan.search_queries).toEqual([{ query: "kernel abi" }]);
  });

  it("ignores queries with empty or non-string query field", () => {
    const input = JSON.stringify({
      search_queries: [
        { query: "valid" },
        { query: "" },
        { query: 123 },
        { notAQuery: "x" },
        {},
      ],
    });
    const plan = extractRecallPlan(input);
    expect(plan.search_queries).toHaveLength(1);
    expect(plan.search_queries[0].query).toBe("valid");
  });

  it("trims whitespace from query / wing / room", () => {
    const input = JSON.stringify({
      search_queries: [{ query: "  kernel  ", wing: " wing_x ", room: " r " }],
    });
    const plan = extractRecallPlan(input);
    expect(plan.search_queries[0]).toEqual({
      query: "kernel",
      wing: "wing_x",
      room: "r",
      rationale: undefined,
    });
  });

  it("drops empty wing/room filters", () => {
    const input = JSON.stringify({
      search_queries: [{ query: "q", wing: "   ", room: "" }],
    });
    const plan = extractRecallPlan(input);
    expect(plan.search_queries[0].wing).toBeUndefined();
    expect(plan.search_queries[0].room).toBeUndefined();
  });

  it("throws if no JSON is present", () => {
    expect(() => extractRecallPlan("just prose")).toThrow(/kein JSON-Objekt/);
  });

  it("throws if search_queries field is missing", () => {
    expect(() => extractRecallPlan(`{"other":[]}`)).toThrow(/search_queries/);
  });

  it("throws if search_queries is not an array", () => {
    expect(() => extractRecallPlan(`{"search_queries":"nope"}`)).toThrow(/search_queries/);
  });

  it("returns empty queries if all are invalid", () => {
    const input = JSON.stringify({ search_queries: [{ query: "" }, {}] });
    const plan = extractRecallPlan(input);
    expect(plan.search_queries).toEqual([]);
  });
});

describe("parseSearchResponse", () => {
  function textResponse(text: string) {
    return { content: [{ type: "text", text }] };
  }

  it("parses a JSON array of drawers at the top level", () => {
    const response = textResponse(JSON.stringify([
      { content: "Decision about MCP", metadata: { type: "decision" }, wing: "w", room: "r" },
      { content: "Fact about kernel ABI", metadata: { type: "fact" } },
    ]));
    const drawers = parseSearchResponse(response);
    expect(drawers).toHaveLength(2);
    expect(drawers[0].type).toBe("decision");
    expect(drawers[0].wing).toBe("w");
    expect(drawers[1].type).toBe("fact");
  });

  it("unwraps {results} container", () => {
    const response = textResponse(JSON.stringify({
      results: [{ content: "X" }, { content: "Y" }],
    }));
    const drawers = parseSearchResponse(response);
    expect(drawers.map((d) => d.content)).toEqual(["X", "Y"]);
  });

  it("unwraps {drawers} container", () => {
    const response = textResponse(JSON.stringify({
      drawers: [{ content: "A", metadata: { type: "lesson" } }],
    }));
    const drawers = parseSearchResponse(response);
    expect(drawers).toHaveLength(1);
    expect(drawers[0].type).toBe("lesson");
  });

  it("unwraps {items} and {matches} and {hits}", () => {
    expect(parseSearchResponse(textResponse(`{"items":[{"content":"i"}]}`))).toHaveLength(1);
    expect(parseSearchResponse(textResponse(`{"matches":[{"content":"m"}]}`))).toHaveLength(1);
    expect(parseSearchResponse(textResponse(`{"hits":[{"content":"h"}]}`))).toHaveLength(1);
  });

  it("reads content from alternative field names (text, drawer, value)", () => {
    const response = textResponse(JSON.stringify([
      { text: "via text" },
      { drawer: "via drawer" },
      { value: "via value" },
    ]));
    const drawers = parseSearchResponse(response);
    expect(drawers.map((d) => d.content)).toEqual(["via text", "via drawer", "via value"]);
  });

  it("skips drawers without any content field", () => {
    const response = textResponse(JSON.stringify([
      { content: "keep" },
      { metadata: { type: "decision" } },
      { content: "   " },
    ]));
    const drawers = parseSearchResponse(response);
    expect(drawers).toHaveLength(1);
    expect(drawers[0].content).toBe("keep");
  });

  it("falls back to newline splitting for non-JSON text", () => {
    const response = textResponse("first result\nsecond result\n\nthird result");
    const drawers = parseSearchResponse(response);
    expect(drawers).toHaveLength(3);
    expect(drawers[0].content).toBe("first result");
    expect(drawers[2].content).toBe("third result");
  });

  it("reads type from metadata nested OR flat", () => {
    const nested = textResponse(JSON.stringify([
      { content: "a", metadata: { type: "finding" } },
    ]));
    const flat = textResponse(JSON.stringify([
      { content: "b", type: "pattern" },
    ]));
    expect(parseSearchResponse(nested)[0].type).toBe("finding");
    expect(parseSearchResponse(flat)[0].type).toBe("pattern");
  });

  it("ignores invalid type values", () => {
    const response = textResponse(JSON.stringify([
      { content: "x", metadata: { type: "rumor" } },
    ]));
    expect(parseSearchResponse(response)[0].type).toBeUndefined();
  });

  it("reads score from score or similarity", () => {
    const response = textResponse(JSON.stringify([
      { content: "a", score: 0.9 },
      { content: "b", similarity: 0.7 },
    ]));
    const drawers = parseSearchResponse(response);
    expect(drawers[0].score).toBe(0.9);
    expect(drawers[1].score).toBe(0.7);
  });

  it("returns empty array for malformed responses", () => {
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse(undefined)).toEqual([]);
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse({ content: [] })).toEqual([]);
    expect(parseSearchResponse({ content: [{ type: "text", text: "" }] })).toEqual([]);
  });
});

describe("groupDrawers", () => {
  it("routes drawers to sections by type", () => {
    const drawers: Drawer[] = [
      { content: "d1", type: "decision" },
      { content: "f1", type: "fact" },
      { content: "fi1", type: "finding" },
      { content: "p1", type: "pattern" },
      { content: "l1", type: "lesson" },
    ];
    const sections = groupDrawers(drawers);
    expect(sections.decisions.map((d) => d.content)).toEqual(["d1"]);
    expect(sections.facts.map((d) => d.content)).toEqual(["f1"]);
    expect(sections.findings.map((d) => d.content)).toEqual(["fi1"]);
    expect(sections.patterns_lessons.map((d) => d.content)).toEqual(["p1", "l1"]);
  });

  it("puts untyped drawers into facts (default section)", () => {
    const sections = groupDrawers([{ content: "unknown origin" }]);
    expect(sections.facts).toHaveLength(1);
    expect(sections.decisions).toHaveLength(0);
  });

  it("deduplicates by content (case-insensitive trim)", () => {
    const sections = groupDrawers([
      { content: "Same Decision", type: "decision" },
      { content: "  same decision  ", type: "decision" },
      { content: "Different", type: "decision" },
    ]);
    expect(sections.decisions).toHaveLength(2);
  });
});

describe("formatContextBlock", () => {
  const emptyResult: RecallResult = {
    sections: { decisions: [], facts: [], findings: [], patterns_lessons: [] },
    total_queries: 2,
    total_hits: 0,
  };

  it("produces all four section headers", () => {
    const out = formatContextBlock(emptyResult, []);
    expect(out).toContain("## Bekannte Entscheidungen");
    expect(out).toContain("## Constraints & Fakten");
    expect(out).toContain("## Bekannte Risiken & Findings");
    expect(out).toContain("## Patterns & Lessons Learned");
  });

  it("shows keine-Einträge marker for empty sections", () => {
    const out = formatContextBlock(emptyResult, []);
    expect(out.match(/_Keine Einträge._/g)?.length).toBe(4);
  });

  it("renders drawers with wing/room suffix when present", () => {
    const result: RecallResult = {
      sections: {
        decisions: [{ content: "Use MCP", type: "decision", wing: "wing_aios_decisions", room: "mcp" }],
        facts: [],
        findings: [],
        patterns_lessons: [],
      },
      total_queries: 1,
      total_hits: 1,
    };
    const out = formatContextBlock(result, [{ query: "mcp" }]);
    expect(out).toContain("- Use MCP _(wing_aios_decisions/mcp)_");
  });

  it("shows skipped_reason prominently", () => {
    const result: RecallResult = {
      ...emptyResult,
      skipped_reason: "MemPalace nicht erreichbar",
    };
    const out = formatContextBlock(result, []);
    expect(out).toContain("Kein Kontext verfügbar: MemPalace nicht erreichbar");
  });

  it("lists executed queries at the bottom", () => {
    const queries: SearchQuery[] = [
      { query: "kernel abi" },
      { query: "mcp policy", wing: "wing_aios_decisions" },
    ];
    const out = formatContextBlock(emptyResult, queries);
    expect(out).toContain("_Suchanfragen:_");
    expect(out).toContain("`kernel abi`");
    expect(out).toContain("`mcp policy` [wing_aios_decisions]");
  });

  it("caps query list at MAX_QUERIES=4", () => {
    const queries: SearchQuery[] = Array.from({ length: 10 }, (_, i) => ({ query: `q${i}` }));
    const out = formatContextBlock(emptyResult, queries);
    expect(out).toContain("`q0`");
    expect(out).toContain("`q3`");
    expect(out).not.toContain("`q4`");
  });

  it("shows hit count summary when there are results", () => {
    const result: RecallResult = {
      sections: {
        decisions: [{ content: "a", type: "decision" }],
        facts: [],
        findings: [],
        patterns_lessons: [],
      },
      total_queries: 2,
      total_hits: 1,
    };
    const out = formatContextBlock(result, []);
    expect(out).toContain("1 Treffer aus 2 Suchanfrage(n)");
  });

  it("shows no-matches message when queries ran but hit nothing", () => {
    const out = formatContextBlock(emptyResult, []);
    expect(out).toContain("Keine relevanten Treffer für 2 Suchanfrage(n)");
  });
});
