import type { PatternMeta, MessageArtifact } from "../types.js";

/**
 * OutputExtractor – extrahiert Artefakte und Summary aus LLM-Output.
 *
 * Verwendet die output_extraction-Konfiguration aus dem Pattern-Frontmatter.
 * Wenn keine Konfiguration vorhanden: Nur Summary, keine Artefakte.
 * Graceful Degradation: Wenn Regex nicht matcht, bleibt artifacts leer.
 */
export class OutputExtractor {
  /**
   * Extrahiert die Zusammenfassung aus dem LLM-Output.
   */
  extractSummary(output: string, strategy?: "first_paragraph" | "first_line" | "none"): string {
    const effectiveStrategy = strategy ?? "first_paragraph";

    if (effectiveStrategy === "none") return "";

    if (effectiveStrategy === "first_line") {
      const firstLine = output.split("\n").find((l) => l.trim().length > 0);
      return firstLine?.trim().slice(0, 200) ?? "";
    }

    // first_paragraph: Erster nicht-leerer Textblock (keine Überschriften)
    const lines = output.split("\n");
    const paragraphLines: string[] = [];
    let started = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Überschriften überspringen
      if (trimmed.startsWith("#")) continue;

      if (trimmed.length > 0) {
        started = true;
        paragraphLines.push(trimmed);
      } else if (started) {
        // Leere Zeile nach begonnenem Absatz = Ende
        break;
      }
    }

    const summary = paragraphLines.join(" ").slice(0, 200);
    return summary || output.slice(0, 200);
  }

  /**
   * Extrahiert Artefakte via Regex aus dem LLM-Output.
   *
   * Das Regex-Pattern kommt aus dem Frontmatter (output_extraction.artifact_pattern).
   * Es MUSS Named Groups enthalten: (?<id>...) und/oder (?<content>...)
   * Optional: (?<severity>...)
   */
  extractArtifacts(output: string, meta: PatternMeta): MessageArtifact[] {
    const extraction = meta.output_extraction;
    if (!extraction?.artifact_pattern) return [];

    const artifacts: MessageArtifact[] = [];
    const type = extraction.artifact_type ?? meta.output_type;

    try {
      const regex = new RegExp(extraction.artifact_pattern, "gm");
      let match: RegExpExecArray | null;

      while ((match = regex.exec(output)) !== null) {
        if (!match.groups) continue;

        artifacts.push({
          type,
          id: match.groups["id"]?.trim(),
          content: match.groups["content"]?.trim() ?? match[0],
          severity: match.groups["severity"]?.trim(),
        });

        // Guard gegen Zero-Width-Matches (Endlosschleife verhindern)
        if (match.index === regex.lastIndex) regex.lastIndex++;
      }
    } catch {
      // Ungültiges Regex → keine Artefakte, kein Crash.
      // Graceful Degradation: Der volle Output geht trotzdem durch.
    }

    return artifacts;
  }
}
