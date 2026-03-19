import { describe, it, expect, vi, beforeEach } from "vitest";
import { SecretResolver } from "./resolver.js";
import type { SecretProvider, SecretRef } from "./secret-provider.js";

/** Creates a mock SecretProvider with an in-memory store */
function mockProvider(name: string, store: Record<string, string> = {}): SecretProvider {
  return {
    name,
    async available() { return true; },
    async get(ref: SecretRef) { return store[ref.key]; },
    async set(ref: SecretRef, value: string) { store[ref.key] = value; },
    async delete(ref: SecretRef) { delete store[ref.key]; },
    async list() { return Object.keys(store).sort(); },
  };
}

describe("SecretResolver", () => {
  it("resolves from first provider that has the key", async () => {
    const primary = mockProvider("primary", { API_KEY: "from-primary" });
    const fallback = mockProvider("fallback", { API_KEY: "from-fallback" });
    const resolver = new SecretResolver([primary, fallback]);

    const value = await resolver.resolve("API_KEY");
    expect(value).toBe("from-primary");
  });

  it("falls back to second provider when first doesn't have key", async () => {
    const primary = mockProvider("primary", {});
    const fallback = mockProvider("fallback", { API_KEY: "from-fallback" });
    const resolver = new SecretResolver([primary, fallback]);

    const value = await resolver.resolve("API_KEY");
    expect(value).toBe("from-fallback");
  });

  it("returns undefined when no provider has the key", async () => {
    const resolver = new SecretResolver([mockProvider("empty")]);
    const value = await resolver.resolve("NONEXISTENT");
    expect(value).toBeUndefined();
  });

  it("caches resolved values", async () => {
    const store = { KEY: "cached" };
    const provider = mockProvider("test", store);
    const getSpy = vi.spyOn(provider, "get");
    const resolver = new SecretResolver([provider]);

    await resolver.resolve("KEY");
    await resolver.resolve("KEY");

    expect(getSpy).toHaveBeenCalledTimes(1); // second call uses cache
  });

  it("clearCache() invalidates the cache", async () => {
    const store = { KEY: "v1" };
    const provider = mockProvider("test", store);
    const resolver = new SecretResolver([provider]);

    expect(await resolver.resolve("KEY")).toBe("v1");

    store.KEY = "v2";
    resolver.clearCache();

    expect(await resolver.resolve("KEY")).toBe("v2");
  });

  it("set() stores via first non-env provider", async () => {
    const kp = mockProvider("keepassxc");
    const env = mockProvider("env");
    const resolver = new SecretResolver([kp, env]);

    await resolver.set("NEW_KEY", "new-value");
    expect(await kp.get({ key: "NEW_KEY" })).toBe("new-value");
    expect(await env.get({ key: "NEW_KEY" })).toBeUndefined();
  });

  it("set() falls back to env when it's the only provider", async () => {
    const env = mockProvider("env");
    const resolver = new SecretResolver([env]);

    await resolver.set("KEY", "value");
    expect(await env.get({ key: "KEY" })).toBe("value");
  });

  it("delete() removes from all providers", async () => {
    const kp = mockProvider("keepassxc", { KEY: "v1" });
    const env = mockProvider("env", { KEY: "v2" });
    const resolver = new SecretResolver([kp, env]);

    await resolver.delete("KEY");
    expect(await kp.get({ key: "KEY" })).toBeUndefined();
    expect(await env.get({ key: "KEY" })).toBeUndefined();
  });

  it("list() merges keys from all providers", async () => {
    const kp = mockProvider("keepassxc", { A: "1", B: "2" });
    const env = mockProvider("env", { B: "3", C: "4" });
    const resolver = new SecretResolver([kp, env]);

    const keys = await resolver.list();
    expect(keys).toEqual(["A", "B", "C"]); // sorted, deduplicated
  });

  it("resolveAll() resolves multiple keys", async () => {
    const provider = mockProvider("test", { A: "1", B: "2", C: "3" });
    const resolver = new SecretResolver([provider]);

    const result = await resolver.resolveAll(["A", "C", "MISSING"]);
    expect(result).toEqual({ A: "1", C: "3" });
  });

  it("skips unavailable providers", async () => {
    const unavailable: SecretProvider = {
      name: "broken",
      async available() { return false; },
      async get() { return "should-not-reach"; },
      async set() {},
      async delete() {},
      async list() { return []; },
    };
    const fallback = mockProvider("fallback", { KEY: "ok" });
    const resolver = new SecretResolver([unavailable, fallback]);

    expect(await resolver.resolve("KEY")).toBe("ok");
  });

  it("logs secret access via audit logger", async () => {
    const mockLogger = { log: vi.fn() } as any;
    const provider = mockProvider("test", { KEY: "secret" });
    const resolver = new SecretResolver([provider], mockLogger);

    await resolver.resolve("KEY");

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "secret_access",
        message: expect.stringContaining("KEY"),
      })
    );
  });

  it("populateEnv() sets process.env for known provider keys", async () => {
    const provider = mockProvider("test", {
      ANTHROPIC_API_KEY: "sk-test",
      GEMINI_API_KEY: "ai-test",
    });
    const resolver = new SecretResolver([provider]);

    // Clean env first
    const origAnth = process.env.ANTHROPIC_API_KEY;
    const origGem = process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      await resolver.populateEnv();
      expect(process.env.ANTHROPIC_API_KEY).toBe("sk-test");
      expect(process.env.GEMINI_API_KEY).toBe("ai-test");
    } finally {
      // Restore
      if (origAnth) process.env.ANTHROPIC_API_KEY = origAnth;
      else delete process.env.ANTHROPIC_API_KEY;
      if (origGem) process.env.GEMINI_API_KEY = origGem;
      else delete process.env.GEMINI_API_KEY;
    }
  });

  it("populateEnv() does not overwrite existing env vars", async () => {
    const provider = mockProvider("test", { ANTHROPIC_API_KEY: "new-key" });
    const resolver = new SecretResolver([provider]);

    process.env.ANTHROPIC_API_KEY = "existing-key";
    try {
      await resolver.populateEnv();
      expect(process.env.ANTHROPIC_API_KEY).toBe("existing-key");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
