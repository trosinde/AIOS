import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiProvider } from "./gemini-provider.js";

describe("GeminiProvider", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: "response text" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("sends correct request to Gemini API", async () => {
    const provider = new GeminiProvider("gemini-2.0-flash", "test-key");
    const result = await provider.complete("system prompt", "user input");

    expect(result.content).toBe("response text");
    expect(result.model).toBe("gemini-2.0-flash");
    expect(result.tokensUsed).toEqual({ input: 10, output: 20 });

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("gemini-2.0-flash:generateContent");
    expect(url).toContain("key=test-key");

    const body = JSON.parse(options.body);
    expect(body.systemInstruction.parts[0].text).toBe("system prompt");
    expect(body.contents[0].parts[0].text).toBe("user input");
  });

  it("sends images as inlineData", async () => {
    const provider = new GeminiProvider("gemini-2.0-flash", "test-key");
    await provider.complete("system", "describe this", ["base64data"]);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const parts = body.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "base64data" } });
    expect(parts[1]).toEqual({ text: "describe this" });
  });

  it("throws on API error", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" });
    const provider = new GeminiProvider("gemini-2.0-flash", "bad-key");
    await expect(provider.complete("sys", "user")).rejects.toThrow("Gemini API error: 401");
  });

  it("throws on error response body", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: { message: "quota exceeded" } }),
    });
    const provider = new GeminiProvider("gemini-2.0-flash", "key");
    await expect(provider.complete("sys", "user")).rejects.toThrow("quota exceeded");
  });

  it("chat maps assistant role to model", async () => {
    const provider = new GeminiProvider("gemini-2.0-flash", "test-key");
    await provider.chat("system", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "bye" },
    ]);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[1].role).toBe("model");
    expect(body.contents[2].role).toBe("user");
  });
});
