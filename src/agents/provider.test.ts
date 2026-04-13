import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProvider } from "./provider.js";
import type { ProviderConfig } from "../types.js";

describe("createProvider", () => {
  it("erstellt ClaudeProvider für anthropic type", () => {
    const config: ProviderConfig = { type: "anthropic", model: "claude-sonnet-4-20250514" };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.complete).toBeTypeOf("function");
  });

  it("erstellt OllamaProvider für ollama type", () => {
    const config: ProviderConfig = { type: "ollama", model: "llama3", endpoint: "http://localhost:11434" };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.complete).toBeTypeOf("function");
  });

  it("wirft Fehler für unbekannten Provider-Typ", () => {
    const config = { type: "unknown", model: "test" } as unknown as ProviderConfig;
    expect(() => createProvider(config)).toThrow("Unknown provider type");
  });

  it("OllamaProvider nutzt Default-Endpoint wenn keiner angegeben", () => {
    const config: ProviderConfig = { type: "ollama", model: "llama3" };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
  });

  it("erstellt OllamaProvider mit apiKey", () => {
    const config: ProviderConfig = {
      type: "ollama",
      model: "qwen2.5:72b",
      endpoint: "http://172.24.32.82:11435",
      apiKey: "test-token-123",
    };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.complete).toBeTypeOf("function");
  });
});

describe("OllamaProvider auth headers", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: { content: "test response" },
        prompt_eval_count: 10,
        eval_count: 20,
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("sendet Authorization header wenn apiKey gesetzt", async () => {
    const config: ProviderConfig = {
      type: "ollama",
      model: "qwen2.5:72b",
      endpoint: "http://172.24.32.82:11435",
      apiKey: "test-token-123",
    };
    const provider = createProvider(config);
    await provider.complete("system", "user input");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token-123",
    });
  });

  it("sendet kein Authorization header ohne apiKey", async () => {
    const config: ProviderConfig = {
      type: "ollama",
      model: "llama3",
      endpoint: "http://localhost:11434",
    };
    const provider = createProvider(config);
    await provider.complete("system", "user input");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(options.headers.Authorization).toBeUndefined();
  });

  it("sendet Authorization header auch bei chat()", async () => {
    const config: ProviderConfig = {
      type: "ollama",
      model: "qwen2.5:72b",
      endpoint: "http://172.24.32.82:11435",
      apiKey: "test-token-123",
    };
    const provider = createProvider(config);
    await provider.chat("system", [{ role: "user", content: "hello" }]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token-123",
    });
  });
});

describe("createProvider – gemini, openai, opencode", () => {
  it("erstellt GeminiProvider mit apiKey", () => {
    const config: ProviderConfig = {
      type: "gemini",
      model: "gemini-2.0-flash",
      apiKey: "test-gemini-key",
    };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.complete).toBeTypeOf("function");
    expect(provider.chat).toBeTypeOf("function");
  });

  it("erstellt OpenAIProvider mit apiKey und endpoint", () => {
    const config: ProviderConfig = {
      type: "openai",
      model: "gpt-4o-mini",
      apiKey: "test-openai-key",
      endpoint: "https://api.openai.com/v1",
    };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.complete).toBeTypeOf("function");
    expect(provider.chat).toBeTypeOf("function");
  });

  it("erstellt OpenCodeProvider mit endpoint", () => {
    const config: ProviderConfig = {
      type: "opencode",
      model: "claude-sonnet",
      endpoint: "/usr/local/bin/opencode",
    };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.complete).toBeTypeOf("function");
  });
});

describe("OllamaProvider error handling", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("wirft Fehler bei HTTP-Fehler von Ollama", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    const provider = createProvider({ type: "ollama", model: "llama3" });
    await expect(provider.complete("sys", "user")).rejects.toThrow("Ollama API error: 500");
  });

  it("wirft Fehler bei Ollama error-Feld in Response", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: "model not found" }),
    });
    const provider = createProvider({ type: "ollama", model: "nonexistent" });
    await expect(provider.complete("sys", "user")).rejects.toThrow("Ollama error: model not found");
  });

  it("wirft Fehler bei leerer Ollama-Antwort", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: {} }),
    });
    const provider = createProvider({ type: "ollama", model: "llama3" });
    await expect(provider.complete("sys", "user")).rejects.toThrow("Keine Antwort");
  });

  it("wirft Fehler bei chat() HTTP-Fehler", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    const provider = createProvider({ type: "ollama", model: "llama3" });
    await expect(provider.chat("sys", [{ role: "user", content: "hi" }])).rejects.toThrow("Ollama API error: 404");
  });

  it("inkludiert images in complete() wenn angegeben", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: { content: "I see an image" },
        prompt_eval_count: 100,
        eval_count: 50,
      }),
    });
    const provider = createProvider({ type: "ollama", model: "llava" });
    const result = await provider.complete("sys", "describe this", ["base64data"]);
    expect(result.content).toBe("I see an image");

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.messages[1].images).toEqual(["base64data"]);
  });

  it("inkludiert images in chat() beim ersten User-Message", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: { content: "response" },
        prompt_eval_count: 10,
        eval_count: 20,
      }),
    });
    const provider = createProvider({ type: "ollama", model: "llava" });
    await provider.chat("sys", [{ role: "user", content: "hello" }], ["imgdata"]);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    // system + user with images
    expect(body.messages[1].images).toEqual(["imgdata"]);
  });
});
