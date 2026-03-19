import type { LLMProvider } from "./provider.js";
import type { ExecutionContext, LLMResponse } from "../types.js";

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

  private isImageModel(): boolean {
    return /image/i.test(this.model);
  }

  async complete(system: string, user: string, images?: string[], _ctx?: ExecutionContext): Promise<LLMResponse> {
    const parts: Array<Record<string, unknown>> = [];

    if (images?.length) {
      for (const img of images) {
        parts.push({ inlineData: { mimeType: "image/png", data: img } });
      }
    }
    parts.push({ text: user });

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
    };

    if (this.isImageModel()) {
      body.generationConfig = { responseModalities: ["IMAGE", "TEXT"] };
    }

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
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Gemini error: ${data.error.message}`);
    }

    const responseParts = data.candidates?.[0]?.content?.parts ?? [];
    const content = responseParts
      .map((p) => p.text ?? "")
      .filter(Boolean)
      .join("");
    const imageResults = responseParts
      .filter((p) => p.inlineData)
      .map((p) => ({ mimeType: p.inlineData!.mimeType, data: p.inlineData!.data }));

    return {
      content,
      model: this.model,
      tokensUsed: {
        input: data.usageMetadata?.promptTokenCount ?? 0,
        output: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      ...(imageResults.length > 0 && { images: imageResults }),
    };
  }

  async chat(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>, images?: string[], _ctx?: ExecutionContext): Promise<LLMResponse> {
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

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
    };

    if (this.isImageModel()) {
      body.generationConfig = { responseModalities: ["IMAGE", "TEXT"] };
    }

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
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Gemini error: ${data.error.message}`);
    }

    const responseParts = data.candidates?.[0]?.content?.parts ?? [];
    const content = responseParts
      .map((p) => p.text ?? "")
      .filter(Boolean)
      .join("");
    const imageResults = responseParts
      .filter((p) => p.inlineData)
      .map((p) => ({ mimeType: p.inlineData!.mimeType, data: p.inlineData!.data }));

    return {
      content,
      model: this.model,
      tokensUsed: {
        input: data.usageMetadata?.promptTokenCount ?? 0,
        output: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      ...(imageResults.length > 0 && { images: imageResults }),
    };
  }
}
