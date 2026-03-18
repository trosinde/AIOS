import type { LLMProvider } from "./provider.js";
import type { LLMResponse } from "../types.js";

/**
 * OpenAI-compatible REST API provider with vision support.
 * Works with OpenAI API and compatible endpoints.
 */
export class OpenAIProvider implements LLMProvider {
  private model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(model: string = "gpt-4o-mini", apiKey: string, baseUrl?: string) {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? "https://api.openai.com/v1";
  }

  async complete(system: string, user: string, images?: string[]): Promise<LLMResponse> {
    const userContent: Array<Record<string, unknown>> = [];
    if (images?.length) {
      for (const img of images) {
        userContent.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
      }
    }
    userContent.push({ type: "text", text: user });

    const body = {
      model: this.model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`OpenAI error: ${data.error.message}`);
    }

    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: this.model,
      tokensUsed: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  async chat(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>, images?: string[]): Promise<LLMResponse> {
    const apiMessages: Array<Record<string, unknown>> = [
      { role: "system", content: system },
    ];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (i === 0 && msg.role === "user" && images?.length) {
        const content: Array<Record<string, unknown>> = [];
        for (const img of images) {
          content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
        }
        content.push({ type: "text", text: msg.content });
        apiMessages.push({ role: "user", content });
      } else {
        apiMessages.push(msg);
      }
    }

    const body = {
      model: this.model,
      max_tokens: 4096,
      messages: apiMessages,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`OpenAI error: ${data.error.message}`);
    }

    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: this.model,
      tokensUsed: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}
