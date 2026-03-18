import type { LLMProvider } from "./provider.js";
import type { LLMResponse } from "../types.js";

/**
 * Google Gemini REST API provider with vision support.
 * Uses generateContent endpoint with API key auth.
 */
export class GeminiProvider implements LLMProvider {
  private model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(model: string = "gemini-2.0-flash", apiKey: string, baseUrl?: string) {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  async complete(system: string, user: string, images?: string[]): Promise<LLMResponse> {
    const parts: Array<Record<string, unknown>> = [];

    if (images?.length) {
      for (const img of images) {
        parts.push({ inlineData: { mimeType: "image/png", data: img } });
      }
    }
    parts.push({ text: user });

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
    };

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Gemini error: ${data.error.message}`);
    }

    const content = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? "";

    return {
      content,
      model: this.model,
      tokensUsed: {
        input: data.usageMetadata?.promptTokenCount ?? 0,
        output: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  async chat(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>, images?: string[]): Promise<LLMResponse> {
    const contents = messages.map((msg, i) => {
      const parts: Array<Record<string, unknown>> = [];
      if (i === 0 && msg.role === "user" && images?.length) {
        for (const img of images) {
          parts.push({ inlineData: { mimeType: "image/png", data: img } });
        }
      }
      parts.push({ text: msg.content });
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts,
      };
    });

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
    };

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Gemini error: ${data.error.message}`);
    }

    const content = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? "";

    return {
      content,
      model: this.model,
      tokensUsed: {
        input: data.usageMetadata?.promptTokenCount ?? 0,
        output: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
