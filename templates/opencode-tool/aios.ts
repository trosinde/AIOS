/**
 * AIOS Custom Tool für OpenCode
 *
 * Installiere in: .opencode/tools/aios.ts (Projekt-lokal)
 * Oder global:    ~/.config/opencode/tools/aios.ts
 *
 * Konfiguration: Setze AIOS_BIN Umgebungsvariable auf den AIOS-Pfad,
 * oder installiere AIOS global (npm install -g aios).
 */
import { tool } from "@opencode-ai/plugin";
import { execSync } from "child_process";

const AIOS_BIN = process.env.AIOS_BIN || "aios";

export default tool({
  description:
    "AIOS AI-Orchestrierung: Code Review, Security Review, Zusammenfassungen, Requirements-Extraktion, Compliance-Reports und mehr. AIOS nutzt wiederverwendbare AI-Patterns die parallel orchestriert werden können. Nutze command='patterns' um alle verfügbaren Patterns zu sehen.",
  args: {
    command: tool.schema
      .enum(["run", "plan", "orchestrate", "patterns"])
      .describe(
        "'run' = einzelnes Pattern ausführen, 'plan' = Workflow planen, 'orchestrate' = dynamisch orchestrieren, 'patterns' = verfügbare Patterns auflisten",
      ),
    pattern: tool.schema
      .string()
      .optional()
      .describe("Pattern-Name für 'run' (z.B. 'code_review', 'security_review', 'summarize')"),
    input: tool.schema
      .string()
      .optional()
      .describe("Input-Text für 'run' oder Aufgabenbeschreibung für 'plan'/'orchestrate'"),
  },
  async execute(args) {
    try {
      let cmd: string;

      switch (args.command) {
        case "run":
          if (!args.pattern || !args.input) return "Fehler: 'run' braucht pattern und input";
          cmd = `echo ${JSON.stringify(args.input)} | ${AIOS_BIN} run ${args.pattern}`;
          break;
        case "plan":
          if (!args.input) return "Fehler: 'plan' braucht input (Aufgabe)";
          cmd = `${AIOS_BIN} plan ${JSON.stringify(args.input)}`;
          break;
        case "orchestrate":
          if (!args.input) return "Fehler: 'orchestrate' braucht input (Aufgabe)";
          cmd = `${AIOS_BIN} ${JSON.stringify(args.input)}`;
          break;
        case "patterns":
          cmd = `${AIOS_BIN} patterns list`;
          break;
        default:
          return "Unbekannter Command. Nutze: run, plan, orchestrate, patterns";
      }

      const result = execSync(cmd, {
        encoding: "utf-8",
        timeout: 120_000,
        env: { ...process.env },
      });

      return result;
    } catch (err: any) {
      return `AIOS Fehler: ${err.stderr || err.message}`;
    }
  },
});
