import { describe, it, expect, vi } from "vitest";
import type { LLMProvider } from "../agents/provider.js";
import type { LLMResponse } from "../types.js";

// Mock provider for testing
function createMockProvider(response: string = "Mock response"): LLMProvider {
  return {
    complete: vi.fn<(system: string, user: string) => Promise<LLMResponse>>().mockResolvedValue({
      content: response,
      model: "mock",
      tokensUsed: { input: 10, output: 20 },
    }),
    chat: vi.fn<(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>) => Promise<LLMResponse>>().mockResolvedValue({
      content: response,
      model: "mock",
      tokensUsed: { input: 10, output: 20 },
    }),
  };
}

describe("Chat provider interface", () => {
  it("mock provider implements both complete and chat", () => {
    const provider = createMockProvider();
    expect(provider.complete).toBeTypeOf("function");
    expect(provider.chat).toBeTypeOf("function");
  });

  it("chat method accepts message history", async () => {
    const provider = createMockProvider("Hello!");
    const messages = [
      { role: "user" as const, content: "Hi" },
      { role: "assistant" as const, content: "Hello" },
      { role: "user" as const, content: "How are you?" },
    ];
    const result = await provider.chat("System prompt", messages);
    expect(result.content).toBe("Hello!");
    expect(provider.chat).toHaveBeenCalledWith("System prompt", messages);
  });

  it("complete method still works for pattern execution", async () => {
    const provider = createMockProvider("Pattern result");
    const result = await provider.complete("Pattern prompt", "User input");
    expect(result.content).toBe("Pattern result");
    expect(provider.complete).toHaveBeenCalledWith("Pattern prompt", "User input");
  });
});
