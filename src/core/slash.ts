import type { SlashCommand } from "../types.js";

export const BUILTIN_COMMANDS = ["help", "history", "clear", "exit", "quit", "patterns"] as const;
export type BuiltinCommand = (typeof BUILTIN_COMMANDS)[number];

export function isBuiltinCommand(name: string): name is BuiltinCommand {
  return (BUILTIN_COMMANDS as readonly string[]).includes(name);
}

/**
 * Parse a line starting with "/" into a SlashCommand.
 * Returns null if the line is not a slash command.
 *
 * Examples:
 *   "/code_review"                      → { name: "code_review", args: "", params: {} }
 *   "/summarize some text here"         → { name: "summarize", args: "some text here", params: {} }
 *   "/analyze --depth=deep the code"    → { name: "analyze", args: "the code", params: { depth: "deep" } }
 */
export function parseSlashCommand(line: string): SlashCommand | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;

  const tokens = trimmed.slice(1).split(/\s+/);
  const name = tokens[0];
  if (!name) return null;

  const params: Record<string, string> = {};
  const argParts: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        params[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
      } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith("--")) {
        params[token.slice(2)] = tokens[++i];
      }
    } else {
      argParts.push(token);
    }
  }

  return { name, args: argParts.join(" "), params };
}
