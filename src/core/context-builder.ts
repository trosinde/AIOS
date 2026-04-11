import type { PatternRegistry } from "./registry.js";
import type { ExecutionStep, StepMessage } from "../types.js";

/**
 * ContextBuilder – baut den Input für einen Step aus seinen
 * Vorgänger-Messages zusammen. EIP-konform: Der Kontext reist
 * mit der Nachricht, der Empfänger muss nichts raten.
 */
export class ContextBuilder {
  constructor(private registry: PatternRegistry) {}

  /**
   * Baut den vollständigen Input-String für einen Step.
   *
   * Jeder Vorgänger-Output wird mit Header-Metadaten versehen:
   * - Typ des Outputs (z.B. "security_findings")
   * - Quelle/Persona (z.B. "security_expert")
   * - Zusammenfassung (Einzeiler)
   * - Artefakte (falls extrahiert)
   * - Vollständiger Inhalt
   */
  build(
    step: ExecutionStep,
    userInput: string,
    messages: Map<string, StepMessage>,
    feedback?: string,
  ): string {
    const sections: string[] = [];

    for (const src of step.input_from) {
      if (src === "$USER_INPUT") {
        sections.push(`## Aufgabe\n\n${userInput}`);
        continue;
      }

      const msg = messages.get(src);
      if (!msg) continue;

      sections.push(this.formatMessage(msg));
    }

    if (feedback) {
      sections.push(`## ⚠️ FEEDBACK AUS VORHERIGEM VERSUCH\n\n${feedback}`);
    }

    return sections.join("\n\n---\n\n");
  }

  /**
   * Raw-Input für MCP-Patterns (kein Markdown-Wrapping, damit JSON parsebar bleibt).
   * Gibt den nackten Content der Vorgänger-Messages aus.
   */
  buildRaw(
    step: ExecutionStep,
    userInput: string,
    messages: Map<string, StepMessage>,
  ): string {
    return step.input_from
      .map((src) => {
        if (src === "$USER_INPUT") return userInput;
        const msg = messages.get(src);
        return msg ? msg.content : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Formatiert eine einzelne Vorgänger-Message für den Empfänger.
   *
   * Aufbau:
   *   ## <output_type> (von <persona>)
   *   > Zusammenfassung: <summary>
   *   ### Artefakte (falls vorhanden)
   *   - [<type>]<severity> <id>: <content>
   *   ### Details
   *   <vollständiger content>
   */
  private formatMessage(msg: StepMessage): string {
    const { source, content, artifacts, summary } = msg;

    // Header: Typ + Herkunft
    const persona = source.persona ?? source.pattern;
    const header = `## ${source.outputType} (von ${persona})`;

    const parts: string[] = [header];

    // Zusammenfassung als Blockquote
    if (summary) {
      parts.push(`> Zusammenfassung: ${summary}`);
    }

    // Artefakte auflisten (falls vorhanden)
    if (artifacts.length > 0) {
      parts.push("### Artefakte");
      const lines: string[] = [];
      for (const a of artifacts) {
        const severity = a.severity ? ` [${a.severity}]` : "";
        const id = a.id ? ` ${a.id}:` : "";
        // Artefakt-Content auf 120 Zeichen kürzen für die Übersicht
        const preview =
          a.content.length > 120 ? a.content.slice(0, 117) + "..." : a.content;
        lines.push(`- [${a.type}]${severity}${id} ${preview}`);
      }
      parts.push(lines.join("\n"));
    }

    // Vollständiger Inhalt
    parts.push(`### Details\n\n${content}`);

    return parts.join("\n\n");
  }
}
