import type { ImageProviderConfig, ImageOptions, ImageResult } from "../types.js";

/**
 * ImageProvider – abstrakte Schnittstelle für Bildgenerierung
 */
export interface ImageProvider {
  generate(prompt: string, options?: ImageOptions): Promise<ImageResult>;
}

// ─── OpenAI (DALL-E 3) ───────────────────────────────────

class OpenAIImageProvider implements ImageProvider {
  private apiKey: string;
  private model: string;

  constructor(config: ImageProviderConfig) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
    this.model = config.model || "dall-e-3";
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY nicht gesetzt");
    }
  }

  async generate(prompt: string, options?: ImageOptions): Promise<ImageResult> {
    const size = options?.size || "1024x1024";
    const quality = options?.quality || "standard";

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: 1,
        size,
        quality,
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(`OpenAI API Error: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{ b64_json: string; revised_prompt?: string }>;
    };

    if (!data.data?.[0]?.b64_json) {
      throw new Error("OpenAI: Keine Bilddaten erhalten");
    }

    return {
      data: Buffer.from(data.data[0].b64_json, "base64"),
      format: "png",
      revisedPrompt: data.data[0].revised_prompt,
    };
  }
}

// ─── Stability AI ────────────────────────────────────────

class StabilityImageProvider implements ImageProvider {
  private apiKey: string;

  constructor(config: ImageProviderConfig) {
    this.apiKey = config.apiKey || process.env.STABILITY_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("STABILITY_API_KEY nicht gesetzt");
    }
  }

  async generate(prompt: string, options?: ImageOptions): Promise<ImageResult> {
    const format = options?.format || "png";

    // Stability AI verwendet FormData
    const formData = new FormData();
    formData.append("prompt", prompt);
    formData.append("output_format", format);

    const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Accept": "image/*",
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Stability API Error: ${text}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Prüfen ob es wirklich ein Bild ist (nicht JSON-Error)
    if (buffer.toString("utf8", 0, 1) === "{") {
      throw new Error(`Stability API Error: ${buffer.toString("utf8")}`);
    }

    return {
      data: buffer,
      format,
    };
  }
}

// ─── Replicate (Flux) ────────────────────────────────────

class ReplicateImageProvider implements ImageProvider {
  private apiKey: string;
  private model: string;

  constructor(config: ImageProviderConfig) {
    this.apiKey = config.apiKey || process.env.REPLICATE_API_TOKEN || "";
    this.model = config.model || "black-forest-labs/flux-schnell";
    if (!this.apiKey) {
      throw new Error("REPLICATE_API_TOKEN nicht gesetzt");
    }
  }

  async generate(prompt: string, _options?: ImageOptions): Promise<ImageResult> {
    // Prediction starten
    const createResponse = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: this.model,
        input: { prompt },
      }),
    });

    if (!createResponse.ok) {
      const err = await createResponse.json() as { detail?: string; error?: string };
      throw new Error(`Replicate API Error: ${err.detail || err.error || createResponse.statusText}`);
    }

    const prediction = await createResponse.json() as {
      urls?: { get?: string };
      status?: string;
      output?: string | string[];
      error?: string;
    };

    const pollUrl = prediction.urls?.get;
    if (!pollUrl) {
      throw new Error(`Replicate: Keine Poll-URL erhalten`);
    }

    // Auf Ergebnis warten (max 120s, alle 2s)
    for (let i = 0; i < 60; i++) {
      const statusResponse = await fetch(pollUrl, {
        headers: { "Authorization": `Bearer ${this.apiKey}` },
      });
      
      const status = await statusResponse.json() as typeof prediction;

      if (status.status === "succeeded") {
        const imageUrl = Array.isArray(status.output) ? status.output[0] : status.output;
        if (!imageUrl) {
          throw new Error("Replicate: Keine Output-URL");
        }

        // Bild herunterladen
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error(`Replicate: Bild-Download fehlgeschlagen`);
        }

        return {
          data: Buffer.from(await imageResponse.arrayBuffer()),
          format: "webp", // Flux gibt normalerweise webp zurück
        };
      }

      if (status.status === "failed") {
        throw new Error(`Replicate Error: ${status.error || "Unknown error"}`);
      }

      // Warten
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error("Replicate: Timeout nach 120s");
  }
}

// ─── Factory ─────────────────────────────────────────────

export function createImageProvider(config: ImageProviderConfig): ImageProvider {
  switch (config.type) {
    case "openai":
      return new OpenAIImageProvider(config);
    case "stability":
      return new StabilityImageProvider(config);
    case "replicate":
      return new ReplicateImageProvider(config);
    default:
      throw new Error(`Unknown image provider type: ${(config as ImageProviderConfig).type}`);
  }
}

/**
 * Convenience-Funktion: Bild generieren mit Default-Provider
 */
export async function generateImage(
  prompt: string,
  options?: ImageOptions & { provider?: ImageProviderConfig }
): Promise<ImageResult> {
  const providerConfig = options?.provider || {
    type: "openai" as const,
  };
  const provider = createImageProvider(providerConfig);
  return provider.generate(prompt, options);
}
