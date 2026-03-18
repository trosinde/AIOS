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
