import Anthropic from "@anthropic-ai/sdk";
import type { LLMResponse, ProviderConfig } from "../types.js";

export interface LLMProvider {
  complete(system: string, user: string, images?: string[]): Promise<LLMResponse>;
  chat(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>, images?: string[]): Promise<LLMResponse>;
}

// ─── Claude (Anthropic API) ──────────────────────────────

class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(model: string) {
    this.client = new Anthropic();
    this.model = model;
  }

  async complete(system: string, user: string, images?: string[]): Promise<LLMResponse> {
    const userContent: Anthropic.ContentBlockParam[] = [];
    if (images?.length) {
      for (const img of images) {
        userContent.push({ type: "image", source: { type: "base64", media_type: "image/png", data: img } });
      }
    }
    userContent.push({ type: "text", text: user });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: userContent }],
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

  async chat(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>, images?: string[]): Promise<LLMResponse> {
    const apiMessages: Anthropic.MessageParam[] = messages.map((msg, i) => {
      if (i === 0 && msg.role === "user" && images?.length) {
        const content: Anthropic.MessageParam["content"] = [];
        for (const img of images) {
          content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: img } });
        }
        content.push({ type: "text", text: msg.content });
        return { role: "user" as const, content };
      }
      return msg;
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: apiMessages,
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
  private apiKey?: string;

  constructor(model: string, endpoint: string = "http://localhost:11434", apiKey?: string) {
    this.model = model;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  async complete(system: string, user: string, images?: string[]): Promise<LLMResponse> {
    const userMsg: Record<string, unknown> = { role: "user", content: user };
    if (images?.length) userMsg.images = images;

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          userMsg,
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      message?: { content: string };
      error?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }
    if (!data.message?.content) {
      throw new Error("Ollama: Keine Antwort erhalten");
    }

    return {
      content: data.message.content,
      model: this.model,
      tokensUsed: {
        input: data.prompt_eval_count ?? 0,
        output: data.eval_count ?? 0,
      },
    };
  }

  async chat(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>, images?: string[]): Promise<LLMResponse> {
    const ollamaMessages: Record<string, unknown>[] = [
      { role: "system", content: system },
      ...messages.map((msg, i) => {
        if (i === 0 && msg.role === "user" && images?.length) {
          return { ...msg, images };
        }
        return msg;
      }),
    ];

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      message?: { content: string };
      error?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }
    if (!data.message?.content) {
      throw new Error("Ollama: Keine Antwort erhalten");
    }

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

import { GeminiProvider } from "./gemini-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.type) {
    case "anthropic":
      return new ClaudeProvider(config.model);
    case "ollama":
      return new OllamaProvider(config.model, config.endpoint, config.apiKey);
    case "gemini":
      return new GeminiProvider(config.model, config.apiKey!);
    case "openai":
      return new OpenAIProvider(config.model, config.apiKey!, config.endpoint);
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}
