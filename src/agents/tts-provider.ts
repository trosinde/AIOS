import type { ExecutionContext } from "../types.js";

// ─── TTS Provider Interface ─────────────────────────────

export interface TTSOptions {
  voice?: string;       // OpenAI: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer"
  model?: string;       // "tts-1" | "tts-1-hd"
  format?: string;      // "mp3" | "wav" | "opus" | "aac"
  speed?: number;       // 0.25 - 4.0
}

export interface TTSResult {
  audioData: Buffer;
  format: string;
}

export interface TTSProvider {
  synthesize(text: string, options?: TTSOptions, ctx?: ExecutionContext): Promise<TTSResult>;
}

// ─── OpenAI TTS Provider ────────────────────────────────

const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
const VALID_FORMATS = ["mp3", "wav", "opus", "aac"] as const;
const VALID_MODELS = ["tts-1", "tts-1-hd"] as const;

export class OpenAITTSProvider implements TTSProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? "https://api.openai.com/v1";
  }

  async synthesize(text: string, options?: TTSOptions, _ctx?: ExecutionContext): Promise<TTSResult> {
    if (!text.trim()) {
      throw new Error("TTS: Leerer Text kann nicht synthetisiert werden");
    }

    const voice = this.validateVoice(options?.voice ?? "alloy");
    const model = this.validateModel(options?.model ?? "tts-1");
    const format = this.validateFormat(options?.format ?? "mp3");
    const speed = this.clampSpeed(options?.speed ?? 1.0);

    const body = {
      model,
      input: text,
      voice,
      response_format: format,
      speed,
    };

    const response = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`OpenAI TTS API error: ${response.status} ${response.statusText} — ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      audioData: Buffer.from(arrayBuffer),
      format,
    };
  }

  private validateVoice(voice: string): string {
    if (!(VALID_VOICES as readonly string[]).includes(voice)) {
      throw new Error(`Ungültige TTS-Stimme: "${voice}". Verfügbar: ${VALID_VOICES.join(", ")}`);
    }
    return voice;
  }

  private validateModel(model: string): string {
    if (!(VALID_MODELS as readonly string[]).includes(model)) {
      throw new Error(`Ungültiges TTS-Modell: "${model}". Verfügbar: ${VALID_MODELS.join(", ")}`);
    }
    return model;
  }

  private validateFormat(format: string): string {
    if (!(VALID_FORMATS as readonly string[]).includes(format)) {
      throw new Error(`Ungültiges Audio-Format: "${format}". Verfügbar: ${VALID_FORMATS.join(", ")}`);
    }
    return format;
  }

  private clampSpeed(speed: number): number {
    return Math.max(0.25, Math.min(4.0, speed));
  }
}

// ─── Factory ────────────────────────────────────────────

export function createTTSProvider(apiKey?: string, baseUrl?: string): TTSProvider {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OpenAI API Key fehlt. Setze OPENAI_API_KEY in ~/.aios/.env oder übergib --api-key.");
  }
  return new OpenAITTSProvider(key, baseUrl);
}
