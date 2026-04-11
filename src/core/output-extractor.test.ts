import { describe, it, expect } from "vitest";
import { OutputExtractor, validateOutputExtraction } from "./output-extractor.js";
import type { PatternMeta } from "../types.js";

function baseMeta(overrides: Partial<PatternMeta> = {}): PatternMeta {
  return {
    name: "test",
    description: "test",
    category: "test",
    input_type: "text",
    output_type: "text",
    tags: [],
    ...overrides,
  };
}

describe("OutputExtractor", () => {
  const extractor = new OutputExtractor();

  describe("extractSummary", () => {
    it("extrahiert ersten Absatz als Default", () => {
      const output = "Dies ist der erste Absatz.\n\nDies ist der zweite.";
      expect(extractor.extractSummary(output)).toBe("Dies ist der erste Absatz.");
    });

    it("überspringt Überschriften", () => {
      const output = "# Titel\n\nErster echter Absatz.";
      expect(extractor.extractSummary(output)).toBe("Erster echter Absatz.");
    });

    it("first_line gibt nur erste Zeile", () => {
      const output = "Erste Zeile\nZweite Zeile";
      expect(extractor.extractSummary(output, "first_line")).toBe("Erste Zeile");
    });

    it("none gibt leeren String", () => {
      expect(extractor.extractSummary("Irgendwas", "none")).toBe("");
    });

    it("begrenzt auf 200 Zeichen", () => {
      const output = "A".repeat(300);
      expect(extractor.extractSummary(output).length).toBeLessThanOrEqual(200);
    });
  });

  describe("extractArtifacts", () => {
    it("extrahiert Requirements mit ID", () => {
      const output = "REQ-001: System muss OAuth2 unterstützen\nREQ-002: Passwörter hashen";
      const meta = baseMeta({
        output_type: "requirements",
        output_extraction: {
          artifact_pattern: "^(?<id>REQ-\\d+):\\s*(?<content>.+)$",
          artifact_type: "requirement",
        },
      });

      const artifacts = extractor.extractArtifacts(output, meta);
      expect(artifacts).toHaveLength(2);
      expect(artifacts[0].id).toBe("REQ-001");
      expect(artifacts[0].type).toBe("requirement");
      expect(artifacts[0].content).toBe("System muss OAuth2 unterstützen");
      expect(artifacts[1].id).toBe("REQ-002");
    });

    it("extrahiert Security-Findings mit Severity", () => {
      const output = "CRITICAL: SQL Injection in auth.ts\nHIGH: Missing CSRF token";
      const meta = baseMeta({
        output_type: "security_findings",
        output_extraction: {
          artifact_pattern: "(?<severity>CRITICAL|HIGH|MEDIUM|LOW):\\s*(?<content>.+)",
          artifact_type: "finding",
        },
      });

      const artifacts = extractor.extractArtifacts(output, meta);
      expect(artifacts).toHaveLength(2);
      expect(artifacts[0].severity).toBe("CRITICAL");
      expect(artifacts[0].content).toBe("SQL Injection in auth.ts");
      expect(artifacts[1].severity).toBe("HIGH");
    });

    it("gibt leeres Array bei fehlendem output_extraction", () => {
      const meta = baseMeta();
      expect(extractor.extractArtifacts("Irgendwas", meta)).toEqual([]);
    });

    it("gibt leeres Array bei ungültigem Regex", () => {
      const meta = baseMeta({
        output_extraction: { artifact_pattern: "[invalid((" },
      });
      expect(extractor.extractArtifacts("Text", meta)).toEqual([]);
    });

    it("gibt leeres Array wenn Regex nicht matcht", () => {
      const meta = baseMeta({
        output_extraction: {
          artifact_pattern: "^(?<id>REQ-\\d+):\\s*(?<content>.+)$",
          artifact_type: "requirement",
        },
      });
      expect(extractor.extractArtifacts("Kein Requirement hier", meta)).toEqual([]);
    });

    it("cappt die Extraktion auf 100 KB gegen ReDoS", () => {
      // Seed-Treffer am Anfang, dann 200 KB Müll hinterher.
      const seed = "REQ-001: echt\n";
      const filler = "x".repeat(200_000);
      const meta = baseMeta({
        output_extraction: {
          artifact_pattern: "^(?<id>REQ-\\d+):\\s*(?<content>.+)$",
          artifact_type: "requirement",
        },
      });
      const artifacts = extractor.extractArtifacts(seed + filler, meta);
      // Der Seed-Treffer wird gefunden, der 200 KB Müll wird vom Cap gestoppt.
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].id).toBe("REQ-001");
    });
  });
});

describe("validateOutputExtraction", () => {
  it("akzeptiert fehlende Config (no-op)", () => {
    expect(() => validateOutputExtraction("p", undefined)).not.toThrow();
    expect(() => validateOutputExtraction("p", {})).not.toThrow();
  });

  it("akzeptiert gültiges Regex mit (?<content>)", () => {
    expect(() => validateOutputExtraction("p", {
      artifact_pattern: "(?<content>.+)",
    })).not.toThrow();
  });

  it("akzeptiert gültiges Regex mit (?<id>)", () => {
    expect(() => validateOutputExtraction("p", {
      artifact_pattern: "(?<id>REQ-\\d+)",
    })).not.toThrow();
  });

  it("wirft bei ungültigem Regex", () => {
    expect(() => validateOutputExtraction("p", {
      artifact_pattern: "[invalid((",
    })).toThrow(/ungültiges artifact_pattern/);
  });

  it("wirft bei fehlenden Named Groups", () => {
    expect(() => validateOutputExtraction("p", {
      artifact_pattern: "CRITICAL|HIGH",
    })).toThrow(/Named Group/);
  });
});
