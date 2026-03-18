import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";
import type { LLMProvider } from "../agents/provider.js";
import type { LLMResponse, ChatSession, AiosConfig } from "../types.js";
import { PatternRegistry } from "./registry.js";
import { PersonaRegistry } from "./personas.js";
import { Router } from "./router.js";
import { Engine } from "./engine.js";
import { executePattern, handleChatTurn, buildChatSystemPrompt } from "./repl.js";
import type { ReplOptions } from "./repl.js";

const PATTERNS_DIR = join(process.cwd(), "patterns");
const PERSONAS_DIR = join(process.cwd(), "personas");

function createMockProvider(response: string = "Mock response"): LLMProvider {
  const llmResponse: LLMResponse = {
    content: response,
    model: "mock",
    tokensUsed: { input: 10, output: 20 },
  };
  return {
    complete: vi.fn<(system: string, user: string) => Promise<LLMResponse>>().mockResolvedValue(llmResponse),
    chat: vi.fn<(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>) => Promise<LLMResponse>>().mockResolvedValue(llmResponse),
  };
}

function createTestConfig(): AiosConfig {
  return {
    providers: {
      test: { type: "anthropic", model: "test-model" },
    },
    defaults: { provider: "test" },
    paths: { patterns: PATTERNS_DIR, personas: PERSONAS_DIR },
    tools: { output_dir: "./output", allowed: [] },
  };
}

function createReplOptions(provider?: LLMProvider): ReplOptions {
  const p = provider ?? createMockProvider();
  const registry = new PatternRegistry(PATTERNS_DIR);
  const personas = new PersonaRegistry(PERSONAS_DIR);
  const router = new Router(registry, p);
  const config = createTestConfig();
  const engine = new Engine(registry, p, config, personas);
  return { provider: p, registry, personas, router, engine, config };
}

// ─── Provider Interface ─────────────────────────────────

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

// ─── buildChatSystemPrompt ──────────────────────────────

describe("buildChatSystemPrompt", () => {
  it("includes pattern names in system prompt", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const prompt = buildChatSystemPrompt(registry);
    expect(prompt).toContain("AIOS");
    expect(prompt).toContain("/");
    // Should contain at least one pattern name
    const patterns = registry.all().filter((p) => !p.meta.internal);
    if (patterns.length > 0) {
      expect(prompt).toContain(patterns[0].meta.name);
    }
  });

  it("excludes internal patterns", () => {
    const registry = new PatternRegistry(PATTERNS_DIR);
    const prompt = buildChatSystemPrompt(registry);
    const internalPatterns = registry.all().filter((p) => p.meta.internal);
    for (const p of internalPatterns) {
      expect(prompt).not.toContain(`/${p.meta.name} –`);
    }
  });
});

// ─── executePattern ─────────────────────────────────────

describe("executePattern", () => {
  it("calls provider.complete with pattern system prompt", async () => {
    const provider = createMockProvider("Review result");
    const options = createReplOptions(provider);

    // Use a real pattern from the registry
    const patterns = options.registry.all().filter((p) => !p.meta.internal && p.meta.type !== "tool");
    if (patterns.length === 0) return; // skip if no LLM patterns available

    const patternName = patterns[0].meta.name;
    const result = await executePattern(patternName, "test input", {}, options);

    expect(result).toBe("Review result");
    expect(provider.complete).toHaveBeenCalledOnce();

    // First arg should be the system prompt (possibly with persona prefix)
    const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).toBe("test input");
  });

  it("throws for unknown pattern", async () => {
    const options = createReplOptions();
    await expect(
      executePattern("nonexistent_pattern_xyz", "input", {}, options)
    ).rejects.toThrow('Pattern "nonexistent_pattern_xyz" nicht gefunden');
  });

  it("injects params into system prompt", async () => {
    const provider = createMockProvider("Result with params");
    const options = createReplOptions(provider);

    const patterns = options.registry.all().filter((p) => !p.meta.internal && p.meta.type !== "tool");
    if (patterns.length === 0) return;

    const patternName = patterns[0].meta.name;
    await executePattern(patternName, "input", { language: "python", depth: "deep" }, options);

    const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    const systemPrompt = callArgs[0] as string;
    expect(systemPrompt).toContain("## PARAMETER");
    expect(systemPrompt).toContain("- language: python");
    expect(systemPrompt).toContain("- depth: deep");
  });

  it("uses 'Keine Eingabe.' when args are empty", async () => {
    const provider = createMockProvider("No input result");
    const options = createReplOptions(provider);

    const patterns = options.registry.all().filter((p) => !p.meta.internal && p.meta.type !== "tool");
    if (patterns.length === 0) return;

    const patternName = patterns[0].meta.name;
    await executePattern(patternName, "", {}, options);

    const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).toBe("Keine Eingabe.");
  });
});

// ─── handleChatTurn ─────────────────────────────────────

describe("handleChatTurn", () => {
  it("calls provider.chat with history and new message", async () => {
    const provider = createMockProvider("Chat response");
    const options = createReplOptions(provider);

    const session: ChatSession = {
      id: "test-session",
      messages: [
        { role: "user", content: "First message", source: "chat" },
        { role: "assistant", content: "First reply", source: "chat" },
      ],
      provider: "test",
    };

    const result = await handleChatTurn("Second message", session, "System prompt", options);

    expect(result).toBe("Chat response");
    expect(provider.chat).toHaveBeenCalledOnce();

    const callArgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe("System prompt");

    const messages = callArgs[1] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(3); // 2 history + 1 new
    expect(messages[0]).toEqual({ role: "user", content: "First message" });
    expect(messages[1]).toEqual({ role: "assistant", content: "First reply" });
    expect(messages[2]).toEqual({ role: "user", content: "Second message" });
  });

  it("works with empty session history", async () => {
    const provider = createMockProvider("First response");
    const options = createReplOptions(provider);

    const session: ChatSession = {
      id: "test-session",
      messages: [],
      provider: "test",
    };

    const result = await handleChatTurn("Hello", session, "System", options);
    expect(result).toBe("First response");

    const callArgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages = callArgs[1] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("applies sliding window (max 50 messages)", async () => {
    const provider = createMockProvider("Windowed response");
    const options = createReplOptions(provider);

    // Create session with 60 messages (over the limit of 50)
    const messages = Array.from({ length: 60 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
      source: "chat",
    }));

    const session: ChatSession = {
      id: "test-session",
      messages,
      provider: "test",
    };

    await handleChatTurn("New message", session, "System", options);

    const callArgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentMessages = callArgs[1] as Array<{ role: string; content: string }>;
    // 50 from sliding window + 1 new message
    expect(sentMessages).toHaveLength(51);
    // First message in window should be message 10 (60 - 50 = 10)
    expect(sentMessages[0].content).toBe("Message 10");
    // Last should be the new message
    expect(sentMessages[50].content).toBe("New message");
  });

  it("strips source field from messages sent to provider", async () => {
    const provider = createMockProvider("Response");
    const options = createReplOptions(provider);

    const session: ChatSession = {
      id: "test-session",
      messages: [
        { role: "user", content: "Test", source: "pattern:code_review" },
      ],
      provider: "test",
    };

    await handleChatTurn("Follow up", session, "System", options);

    const callArgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentMessages = callArgs[1] as Array<Record<string, unknown>>;
    // Messages sent to provider should only have role and content (no source)
    for (const msg of sentMessages) {
      expect(msg).not.toHaveProperty("source");
    }
  });

  it("propagates provider errors", async () => {
    const provider = createMockProvider();
    (provider.chat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("API timeout"));
    const options = createReplOptions(provider);

    const session: ChatSession = { id: "test", messages: [], provider: "test" };

    await expect(
      handleChatTurn("Hello", session, "System", options)
    ).rejects.toThrow("API timeout");
  });
});
