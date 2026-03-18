import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider } from "./openai-provider.js";

describe("OpenAIProvider", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "response text" } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("sends correct request to OpenAI API", async () => {
    const provider = new OpenAIProvider("gpt-4o-mini", "test-key");
    const result = await provider.complete("system prompt", "user input");

    expect(result.content).toBe("response text");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.tokensUsed).toEqual({ input: 10, output: 20 });

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer test-key");

    const body = JSON.parse(options.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0]).toEqual({ role: "system", content: "system prompt" });
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content[0]).toEqual({ type: "text", text: "user input" });
  });

  it("sends images as image_url content parts", async () => {
    const provider = new OpenAIProvider("gpt-4o-mini", "test-key");
    await provider.complete("system", "describe this", ["base64data"]);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const userContent = body.messages[1].content;
    expect(userContent[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,base64data" },
    });
    expect(userContent[1]).toEqual({ type: "text", text: "describe this" });
  });

  it("uses custom base URL", async () => {
    const provider = new OpenAIProvider("gpt-4o-mini", "key", "https://custom.api.com/v1");
    await provider.complete("sys", "user");

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://custom.api.com/v1/chat/completions");
  });

  it("throws on API error", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" });
    const provider = new OpenAIProvider("gpt-4o-mini", "key");
    await expect(provider.complete("sys", "user")).rejects.toThrow("OpenAI API error: 429");
  });

  it("throws on error response body", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: { message: "invalid api key" } }),
    });
    const provider = new OpenAIProvider("gpt-4o-mini", "bad-key");
    await expect(provider.complete("sys", "user")).rejects.toThrow("invalid api key");
  });

  it("chat sends messages with auth header", async () => {
    const provider = new OpenAIProvider("gpt-4o-mini", "test-key");
    await provider.chat("system", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(3); // system + 2 chat messages
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[2].role).toBe("assistant");
  });
});
