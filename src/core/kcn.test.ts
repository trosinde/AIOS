import { describe, it, expect } from "vitest";
import {
  encodeItem,
  encodeItems,
  decodeItem,
  decodeItems,
  encodeMessages,
  estimateTokens,
  encodeAsJson,
  encodeAsMarkdown,
} from "./kcn.js";
import type { KernelMessage } from "../types.js";

describe("KCN — Knowledge Compact Notation", () => {
  // ─── encodeItem ────────────────────────────────────────

  it("encodes a full item with all fields", () => {
    const out = encodeItem({
      type: "decision",
      wing: "wing_aios_decisions",
      room: "kernel_abi",
      tags: ["abi", "stable"],
      content: "LanceDB chosen as KB backend.",
    });
    expect(out).toBe("[D|wing_aios_decisions|kernel_abi|abi,stable]\nLanceDB chosen as KB backend.");
  });

  it("drops trailing empty fields for compactness", () => {
    const out = encodeItem({
      type: "fact",
      content: "768-dim embeddings",
    });
    expect(out).toBe("[F]\n768-dim embeddings");
  });

  it("preserves middle empty fields", () => {
    const out = encodeItem({
      type: "decision",
      wing: "wing_aios",
      tags: ["stable"],
      content: "x",
    });
    // room is empty but wing and tags are set, so room is ""
    expect(out).toBe("[D|wing_aios||stable]\nx");
  });

  it("uses correct type abbreviations", () => {
    expect(encodeItem({ type: "decision", content: "" }).startsWith("[D")).toBe(true);
    expect(encodeItem({ type: "fact", content: "" }).startsWith("[F")).toBe(true);
    expect(encodeItem({ type: "requirement", content: "" }).startsWith("[R")).toBe(true);
    expect(encodeItem({ type: "artifact", content: "" }).startsWith("[A")).toBe(true);
  });

  // ─── decodeItem ────────────────────────────────────────

  it("decodes what encodeItem produced (round-trip)", () => {
    const item = {
      type: "fact" as const,
      wing: "wing_aios",
      room: "embeddings",
      tags: ["ollama", "768d"],
      content: "Multi-line content\nwith a second line.",
    };
    const decoded = decodeItem(encodeItem(item));
    expect(decoded).toEqual(item);
  });

  it("handles content-only input as a fact fallback", () => {
    const item = decodeItem("Just a plain note without header.");
    expect(item?.type).toBe("fact");
    expect(item?.content).toBe("Just a plain note without header.");
    expect(item?.wing).toBeUndefined();
  });

  it("handles missing optional fields", () => {
    const item = decodeItem("[D]\nDecision text");
    expect(item).toEqual({
      type: "decision",
      wing: undefined,
      room: undefined,
      tags: undefined,
      content: "Decision text",
    });
  });

  it("decodes content with pipes inside body", () => {
    const item = decodeItem("[F|wing|room]\nContent | with | pipes");
    expect(item?.content).toBe("Content | with | pipes");
  });

  // ─── encodeItems / decodeItems ─────────────────────────

  it("round-trips multiple items via separator", () => {
    const items = [
      { type: "decision" as const, wing: "w1", content: "First decision" },
      { type: "fact" as const, content: "Second item" },
      { type: "finding" as const, tags: ["security"], content: "Third with tag" },
    ];
    const encoded = encodeItems(items);
    const decoded = decodeItems(encoded);
    expect(decoded).toHaveLength(3);
    expect(decoded[0].type).toBe("decision");
    expect(decoded[0].wing).toBe("w1");
    expect(decoded[1].type).toBe("fact");
    expect(decoded[2].type).toBe("finding");
    expect(decoded[2].tags).toEqual(["security"]);
  });

  it("returns empty array for empty input", () => {
    expect(decodeItems("")).toEqual([]);
    expect(decodeItems("   \n  ")).toEqual([]);
  });

  // ─── KernelMessage convenience ─────────────────────────

  it("encodes a list of KernelMessages", () => {
    const messages: KernelMessage[] = [
      {
        id: "1",
        trace_id: "t1",
        source_context: "c1",
        target_context: "c1",
        created_at: 1,
        type: "decision",
        tags: ["abi"],
        source_pattern: "design",
        content: "Use LanceDB",
        format: "text",
        wing: "wing_aios_decisions",
        room: "kernel_abi",
      },
    ];
    const out = encodeMessages(messages);
    expect(out).toBe("[D|wing_aios_decisions|kernel_abi|abi]\nUse LanceDB");
  });

  // ─── Token efficiency vs alternatives ──────────────────

  it("KCN uses fewer tokens than JSON for typical recall blocks", () => {
    const messages: KernelMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: `id${i}`,
      trace_id: "t1",
      source_context: "c1",
      target_context: "c1",
      created_at: 1,
      type: "decision",
      tags: ["abi", "stable"],
      source_pattern: "design",
      content: `Decision ${i}: use LanceDB for vector storage in the kernel knowledge bus`,
      format: "text",
      wing: "wing_aios_decisions",
      room: "kernel_abi",
    }));

    const kcnTokens = estimateTokens(encodeMessages(messages));
    const jsonTokens = estimateTokens(encodeAsJson(messages));
    const markdownTokens = estimateTokens(encodeAsMarkdown(messages));

    // KCN must be cheaper than both JSON and Markdown for the same content.
    expect(kcnTokens).toBeLessThan(jsonTokens);
    expect(kcnTokens).toBeLessThan(markdownTokens);

    // Sanity: at least 30% fewer tokens than JSON for this kind of payload.
    expect(kcnTokens).toBeLessThan(jsonTokens * 0.7);
  });
});
