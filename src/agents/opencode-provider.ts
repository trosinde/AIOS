/**
 * OpenCode Provider – nutzt `opencode run` als LLM-Backend.
 *
 * Damit hat AIOS Zugriff auf alle 75+ Provider die OpenCode unterstützt,
 * plus OpenCode's Built-in Tools (Bash, Read, Write, Grep, LSP).
 *
 * Limitierungen:
 * - Kein separater System-Prompt (wird mit User-Input kombiniert)
 * - Keine Token-Counts im Output
 * - opencode run Timeout: 5 Minuten
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { LLMProvider } from "./provider.js";
import type { ExecutionContext, LLMResponse } from "../types.js";

const execFileAsync = promisify(execFile);

export class OpenCodeProvider implements LLMProvider {
  private model: string;
  private serverUrl?: string;
  private timeout: number;

  constructor(model: string, serverUrl?: string, timeout = 300_000) {
    this.model = model;
    this.serverUrl = serverUrl;
    this.timeout = timeout;
  }

  async complete(system: string, user: string, _images?: string[], _ctx?: ExecutionContext): Promise<LLMResponse> {
    // opencode run has no separate system prompt parameter —
    // combine system + user with separator
    const combinedPrompt = `${system}\n\n---\n\n${user}`;

    const args = ["run"];
    if (this.model) args.push("--model", this.model);
    if (this.serverUrl) args.push("--attach", this.serverUrl);
    args.push(combinedPrompt);

    const { stdout } = await execFileAsync("opencode", args, {
      encoding: "utf-8",
      timeout: this.timeout,
      env: { ...process.env },
    });

    return {
      content: stdout,
      model: this.model,
      tokensUsed: { input: 0, output: 0 }, // opencode doesn't report token counts
    };
  }

  async chat(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    _images?: string[],
    _ctx?: ExecutionContext,
  ): Promise<LLMResponse> {
    // Flatten chat history into a single prompt for opencode run
    const conversationParts = messages.map(
      (m) => `[${m.role}]: ${m.content}`,
    );
    const combinedPrompt = `${system}\n\n---\n\nConversation:\n${conversationParts.join("\n\n")}`;

    const args = ["run"];
    if (this.model) args.push("--model", this.model);
    if (this.serverUrl) args.push("--attach", this.serverUrl);
    args.push(combinedPrompt);

    const { stdout } = await execFileAsync("opencode", args, {
      encoding: "utf-8",
      timeout: this.timeout,
      env: { ...process.env },
    });

    return {
      content: stdout,
      model: this.model,
      tokensUsed: { input: 0, output: 0 },
    };
  }
}
