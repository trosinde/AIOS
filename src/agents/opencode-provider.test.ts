import { describe, it, expect, vi } from "vitest";
import { OpenCodeProvider } from "./opencode-provider.js";

// Mock child_process.execFile
vi.mock("child_process", () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    if (typeof opts === "function") {
      cb = opts;
    }
    // Simulate opencode run output
    cb(null, { stdout: "OpenCode response content", stderr: "" });
  }),
}));

vi.mock("util", async () => {
  const actual = await vi.importActual("util");
  return {
    ...actual,
    promisify: vi.fn((fn: any) => {
      return async (...args: any[]) => {
        return { stdout: "OpenCode response content", stderr: "" };
      };
    }),
  };
});

describe("OpenCodeProvider", () => {
  it("implements LLMProvider interface", () => {
    const provider = new OpenCodeProvider("google/gemini-2.5-pro");
    expect(provider.complete).toBeDefined();
    expect(provider.chat).toBeDefined();
  });

  it("complete combines system and user prompt", async () => {
    const provider = new OpenCodeProvider("test-model");
    const result = await provider.complete("System prompt", "User input");

    expect(result.content).toBe("OpenCode response content");
    expect(result.model).toBe("test-model");
    expect(result.tokensUsed).toEqual({ input: 0, output: 0 });
  });

  it("chat flattens conversation history", async () => {
    const provider = new OpenCodeProvider("test-model");
    const result = await provider.chat("System prompt", [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "How are you?" },
    ]);

    expect(result.content).toBe("OpenCode response content");
    expect(result.model).toBe("test-model");
  });

  it("accepts serverUrl for opencode serve", () => {
    const provider = new OpenCodeProvider("test-model", "http://localhost:4096");
    expect(provider).toBeDefined();
  });
});
