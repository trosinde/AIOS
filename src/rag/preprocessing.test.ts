import { describe, it, expect } from "vitest";
import { applyCleaners, chunkText, concatFields, registerCleaner } from "./preprocessing.js";

describe("Preprocessing", () => {
  describe("applyCleaners", () => {
    it("strips HTML tags", () => {
      const result = applyCleaners("<p>Hello <b>World</b></p>", ["stripHtml"]);
      expect(result).toContain("Hello");
      expect(result).toContain("World");
      expect(result).not.toContain("<p>");
    });

    it("normalizes whitespace", () => {
      const result = applyCleaners("  hello   world\n\t  foo  ", ["normalizeWhitespace"]);
      expect(result).toBe("hello world foo");
    });

    it("chains cleaners", () => {
      const result = applyCleaners("<p>  hello  </p>  world ", ["stripHtml", "normalizeWhitespace"]);
      expect(result).toBe("hello world");
    });

    it("throws on unknown cleaner", () => {
      expect(() => applyCleaners("test", ["nonexistent"])).toThrow('Cleaner "nonexistent" nicht registriert');
    });

    it("supports custom cleaners", () => {
      registerCleaner("uppercase", (t) => t.toUpperCase());
      const result = applyCleaners("hello", ["uppercase"]);
      expect(result).toBe("HELLO");
    });
  });

  describe("chunkText", () => {
    const baseConfig = {
      maxChunkLength: 20,
      chunkStrategy: "truncate" as const,
      cleaners: [],
    };

    it("returns full text if under limit", () => {
      const chunks = chunkText("short", baseConfig);
      expect(chunks).toEqual(["short"]);
    });

    it("truncate: single chunk", () => {
      const chunks = chunkText("a".repeat(50), { ...baseConfig, chunkStrategy: "truncate" });
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toHaveLength(20);
    });

    it("sliding_window: overlapping chunks", () => {
      const text = "abcdefghijklmnopqrstuvwxyz0123456789";
      const chunks = chunkText(text, {
        ...baseConfig,
        chunkStrategy: "sliding_window",
        maxChunkLength: 10,
        chunkOverlap: 3,
      });
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toHaveLength(10);
      // Check overlap: last 3 chars of chunk 0 should equal first 3 chars of chunk 1
      expect(chunks[0].slice(-3)).toBe(chunks[1].slice(0, 3));
    });

    it("sentence: splits on sentence boundaries", () => {
      const text = "First sentence. Second sentence. Third sentence. Fourth sentence is long enough to overflow.";
      const chunks = chunkText(text, {
        ...baseConfig,
        chunkStrategy: "sentence",
        maxChunkLength: 40,
      });
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(92); // at least one sentence fits
      }
    });
  });

  describe("concatFields", () => {
    it("concatenates specified fields", () => {
      const item = { title: "Test", description: "A test item", priority: 1, tags: null };
      const result = concatFields(item, ["title", "description", "tags"]);
      expect(result).toBe("Test | A test item");
    });

    it("uses custom separator", () => {
      const result = concatFields({ a: "X", b: "Y" }, ["a", "b"], " - ");
      expect(result).toBe("X - Y");
    });
  });
});
