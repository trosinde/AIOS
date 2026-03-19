import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EnvSecretProvider } from "./env-provider.js";

// We test the helpers by accessing the provider methods.
// For isolation, we mock AIOS_HOME via a subclass that overrides paths.

class TestEnvProvider extends EnvSecretProvider {
  constructor(private testHome: string) {
    super();
    // Override internal path resolution by patching the private helpers
  }
}

describe("EnvSecretProvider", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `aios-test-env-${Date.now()}`);
    mkdirSync(join(tempDir, ".aios"), { recursive: true });
    originalHome = process.env.HOME ?? "";
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("available() always returns true", async () => {
    const provider = new EnvSecretProvider();
    expect(await provider.available()).toBe(true);
  });

  it("name is 'env'", () => {
    const provider = new EnvSecretProvider();
    expect(provider.name).toBe("env");
  });

  it("get() returns undefined when no .env exists", async () => {
    const provider = new EnvSecretProvider();
    const value = await provider.get({ key: "NONEXISTENT_KEY" });
    // May return from process.env, but NONEXISTENT_KEY shouldn't exist
    expect(value).toBeUndefined();
  });

  it("get() reads from process.env as fallback", async () => {
    const testKey = `AIOS_TEST_KEY_${Date.now()}`;
    process.env[testKey] = "from-env";
    try {
      const provider = new EnvSecretProvider();
      const value = await provider.get({ key: testKey });
      expect(value).toBe("from-env");
    } finally {
      delete process.env[testKey];
    }
  });

  it("set() and get() round-trip for global secrets", async () => {
    const provider = new EnvSecretProvider();
    await provider.set({ key: "TEST_SECRET" }, "my-value");

    const envPath = join(tempDir, ".aios", ".env");
    expect(existsSync(envPath)).toBe(true);

    // Check file permissions (should be 600)
    const stats = statSync(envPath);
    expect(stats.mode & 0o777).toBe(0o600);

    // Check content
    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("TEST_SECRET=my-value");
  });

  it("set() creates context-scoped .env", async () => {
    const provider = new EnvSecretProvider();
    await provider.set({ key: "CTX_KEY", context_id: "myctx" }, "ctx-value");

    const ctxEnvPath = join(tempDir, ".aios", "contexts", "myctx", ".env");
    expect(existsSync(ctxEnvPath)).toBe(true);
    const content = readFileSync(ctxEnvPath, "utf-8");
    expect(content).toContain("CTX_KEY=ctx-value");
  });

  it("list() returns keys from .env file", async () => {
    const provider = new EnvSecretProvider();
    await provider.set({ key: "KEY_A" }, "val-a");
    await provider.set({ key: "KEY_B" }, "val-b");

    const keys = await provider.list();
    expect(keys).toContain("KEY_A");
    expect(keys).toContain("KEY_B");
  });

  it("delete() removes a key from .env", async () => {
    const provider = new EnvSecretProvider();
    await provider.set({ key: "DEL_KEY" }, "to-delete");
    await provider.delete({ key: "DEL_KEY" });

    const envPath = join(tempDir, ".aios", ".env");
    const content = readFileSync(envPath, "utf-8");
    expect(content).not.toContain("DEL_KEY");
  });

  it("set() updates existing key value", async () => {
    const provider = new EnvSecretProvider();
    await provider.set({ key: "UPD_KEY" }, "old-value");
    await provider.set({ key: "UPD_KEY" }, "new-value");

    const envPath = join(tempDir, ".aios", ".env");
    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("UPD_KEY=new-value");
    expect(content).not.toContain("old-value");
  });
});
