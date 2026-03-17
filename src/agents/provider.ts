import Anthropic from "@anthropic-ai/sdk";
import type { LLMResponse, ProviderConfig } from "../types.js";

export interface LLMProvider {
  complete(system: string, user: string): Promise<LLMResponse>;
}

// ─── Claude (Anthropic API) ──────────────────────────────

class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(model: string) {
    this.client = new Anthropic();
    this.model = model;
  }

  async complete(system: string, user: string): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });

    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      content,
      model: this.model,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  }
}

// ─── Ollama (REST API) ───────────────────────────────────

class OllamaProvider implements LLMProvider {
  private model: string;
  private endpoint: string;

  constructor(model: string, endpoint: string = "http://localhost:11434") {
    this.model = model;
    this.endpoint = endpoint;
  }

  async complete(system: string, user: string): Promise<LLMResponse> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
      }),
    });

    const data = await response.json();
    return {
      content: data.message.content,
      model: this.model,
      tokensUsed: {
        input: data.prompt_eval_count ?? 0,
        output: data.eval_count ?? 0,
      },
    };
  }
}

// ─── Factory ─────────────────────────────────────────────

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.type) {
    case "anthropic":
      return new ClaudeProvider(config.model);
    case "ollama":
      return new OllamaProvider(config.model, config.endpoint);
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}
