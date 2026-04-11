import type { PatternMeta, MessageArtifact } from "../types.js";

/**
 * Schutz gegen ReDoS: LLM-Output kann groß werden (bis zu 200k Tokens).
 * Wir cappen die für Regex-Extraction verarbeitete Textlänge auf 100 KB.
 * Wer mehr Artefakte braucht, soll Summarization davorschalten.
 */
const MAX_EXTRACTION_BYTES = 100_000;

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

    // Size-Cap gegen ReDoS auf großen LLM-Outputs.
    const scanTarget = output.length > MAX_EXTRACTION_BYTES
      ? output.slice(0, MAX_EXTRACTION_BYTES)
      : output;

    try {
      const regex = new RegExp(extraction.artifact_pattern, "gm");
      let match: RegExpExecArray | null;

      while ((match = regex.exec(scanTarget)) !== null) {
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
    } catch (e) {
      // Ungültiges Regex sollte eigentlich am Load schon gefiltert worden sein.
      // Wenn wir hier landen: sichtbar auf stderr, aber kein Crash (der Output
      // selbst ist weiterhin wertvoll und geht ungefiltert durch).
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`⚠️ OutputExtractor: Regex-Fehler in Pattern "${meta.name}": ${msg}`);
    }

    return artifacts;
  }
}

/**
 * Validiert eine `output_extraction`-Konfiguration am Pattern-Load.
 * Fail-fast: ungültiges Regex oder fehlende Named Groups → Exception.
 *
 * Akzeptiert entweder (?<content>…) ODER (?<id>…) als minimal benötigten
 * Named Group. Ein Pattern ohne beide ist nicht brauchbar und wird abgelehnt.
 */
export function validateOutputExtraction(
  patternName: string,
  extraction: { artifact_pattern?: string } | undefined,
): void {
  if (!extraction?.artifact_pattern) return;

  let regex: RegExp;
  try {
    regex = new RegExp(extraction.artifact_pattern, "gm");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Pattern "${patternName}": ungültiges artifact_pattern-Regex: ${msg}`,
    );
  }

  // Sniff: Hat das Regex überhaupt Named Groups?
  const source = regex.source;
  const hasContent = /\(\?<content>/.test(source);
  const hasId = /\(\?<id>/.test(source);
  if (!hasContent && !hasId) {
    throw new Error(
      `Pattern "${patternName}": artifact_pattern braucht mindestens eine Named Group (?<content>...) oder (?<id>...)`,
    );
  }
}
