import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAITTSProvider, createTTSProvider } from "./tts-provider.js";

describe("OpenAITTSProvider", () => {
  let provider: OpenAITTSProvider;

  beforeEach(() => {
    provider = new OpenAITTSProvider("test-api-key", "https://api.test.com/v1");
  });

  it("sollte leeren Text ablehnen", async () => {
    await expect(provider.synthesize("")).rejects.toThrow("Leerer Text");
    await expect(provider.synthesize("   ")).rejects.toThrow("Leerer Text");
  });

  it("sollte ungültige Stimmen ablehnen", async () => {
    await expect(provider.synthesize("Hallo", { voice: "invalid" })).rejects.toThrow("Ungültige TTS-Stimme");
  });

  it("sollte ungültige Modelle ablehnen", async () => {
    await expect(provider.synthesize("Hallo", { model: "gpt-4" })).rejects.toThrow("Ungültiges TTS-Modell");
  });

  it("sollte ungültige Formate ablehnen", async () => {
    await expect(provider.synthesize("Hallo", { format: "flac" })).rejects.toThrow("Ungültiges Audio-Format");
  });

  it("sollte gültige Stimmen akzeptieren", async () => {
    const mockResponse = new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

    const result = await provider.synthesize("Hallo", { voice: "nova" });
    expect(result.format).toBe("mp3");
    expect(result.audioData).toBeInstanceOf(Buffer);
    expect(result.audioData.length).toBe(3);

    vi.restoreAllMocks();
  });

  it("sollte korrekte API-Parameter senden", async () => {
    const mockResponse = new Response(new Uint8Array([0xFF]), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

    await provider.synthesize("Test text", {
      voice: "shimmer",
      model: "tts-1-hd",
      format: "wav",
      speed: 1.5,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.test.com/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
        }),
      })
    );

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody).toEqual({
      model: "tts-1-hd",
      input: "Test text",
      voice: "shimmer",
      response_format: "wav",
      speed: 1.5,
    });

    vi.restoreAllMocks();
  });

  it("sollte Speed auf 0.25-4.0 clampen", async () => {
    const mockResponse = new Response(new Uint8Array([0xFF]), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

    await provider.synthesize("Test", { speed: 10.0 });

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.speed).toBe(4.0);

    vi.restoreAllMocks();
  });

  it("sollte Speed unter Minimum clampen", async () => {
    const mockResponse = new Response(new Uint8Array([0xFF]), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

    await provider.synthesize("Test", { speed: 0.1 });

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.speed).toBe(0.25);

    vi.restoreAllMocks();
  });

  it("sollte API-Fehler weiterleiten", async () => {
    const mockResponse = new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

    await expect(provider.synthesize("Hallo")).rejects.toThrow("OpenAI TTS API error: 401");

    vi.restoreAllMocks();
  });

  it("sollte Default-Optionen verwenden", async () => {
    const mockResponse = new Response(new Uint8Array([0xFF]), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

    await provider.synthesize("Default test");

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.voice).toBe("alloy");
    expect(callBody.model).toBe("tts-1");
    expect(callBody.response_format).toBe("mp3");
    expect(callBody.speed).toBe(1.0);

    vi.restoreAllMocks();
  });

  it("sollte Netzwerkfehler weiterleiten", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(provider.synthesize("Hallo")).rejects.toThrow("ECONNREFUSED");

    vi.restoreAllMocks();
  });

  it("sollte response.text()-Fehler abfangen", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.reject(new Error("Body read failed")),
    } as unknown as Response;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

    await expect(provider.synthesize("Hallo")).rejects.toThrow("OpenAI TTS API error: 500 Internal Server Error — Unknown error");

    vi.restoreAllMocks();
  });
});

describe("createTTSProvider", () => {
  it("sollte Fehler werfen wenn kein API-Key", () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    expect(() => createTTSProvider()).toThrow("API Key fehlt");

    if (original) process.env.OPENAI_API_KEY = original;
  });

  it("sollte Provider mit explizitem Key erstellen", () => {
    const provider = createTTSProvider("explicit-key");
    expect(provider).toBeDefined();
  });

  it("sollte Provider aus Umgebungsvariable erstellen", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "env-key";

    const provider = createTTSProvider();
    expect(provider).toBeDefined();

    if (original) {
      process.env.OPENAI_API_KEY = original;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
