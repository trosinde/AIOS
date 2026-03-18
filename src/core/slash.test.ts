import { describe, it, expect } from "vitest";
import { parseSlashCommand, isBuiltinCommand, BUILTIN_COMMANDS } from "./slash.js";

describe("parseSlashCommand", () => {
  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello world")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
    expect(parseSlashCommand("  no slash")).toBeNull();
  });

  it("parses simple command without args", () => {
    const cmd = parseSlashCommand("/help");
    expect(cmd).toEqual({ name: "help", args: "", params: {} });
  });

  it("parses command with text args", () => {
    const cmd = parseSlashCommand("/summarize some text here");
    expect(cmd).toEqual({ name: "summarize", args: "some text here", params: {} });
  });

  it("parses command with --key=value params", () => {
    const cmd = parseSlashCommand("/analyze --depth=deep --format=json");
    expect(cmd).toEqual({ name: "analyze", args: "", params: { depth: "deep", format: "json" } });
  });

  it("parses command with --key value params", () => {
    const cmd = parseSlashCommand("/run --provider ollama");
    expect(cmd).toEqual({ name: "run", args: "", params: { provider: "ollama" } });
  });

  it("parses mixed args and params", () => {
    const cmd = parseSlashCommand("/code_review --language=python check this function");
    expect(cmd).toEqual({
      name: "code_review",
      args: "check this function",
      params: { language: "python" },
    });
  });

  it("handles leading/trailing whitespace", () => {
    const cmd = parseSlashCommand("  /exit  ");
    expect(cmd).toEqual({ name: "exit", args: "", params: {} });
  });

  it("returns null for lone slash", () => {
    expect(parseSlashCommand("/")).toBeNull();
    expect(parseSlashCommand("/ ")).toBeNull();
  });
});

describe("isBuiltinCommand", () => {
  it("recognizes all builtin commands", () => {
    for (const cmd of BUILTIN_COMMANDS) {
      expect(isBuiltinCommand(cmd)).toBe(true);
    }
  });

  it("rejects non-builtin names", () => {
    expect(isBuiltinCommand("summarize")).toBe(false);
    expect(isBuiltinCommand("code_review")).toBe(false);
  });
});
