import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { KeePassXCProvider } from "./keepassxc-provider.js";

describe("KeePassXCProvider", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `aios-test-kp-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    dbPath = join(tempDir, "test.kdbx");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createProvider(): KeePassXCProvider {
    const provider = new KeePassXCProvider({
      database: dbPath,
      group: "AIOS",
    });
    provider.setMasterPassword("test-password");
    return provider;
  }

  it("name is 'keepassxc'", () => {
    const provider = createProvider();
    expect(provider.name).toBe("keepassxc");
  });

  it("available() returns true when kdbxweb can be loaded", async () => {
    const provider = createProvider();
    expect(await provider.available()).toBe(true);
  });

  it("creates a new database on first set()", async () => {
    const provider = createProvider();
    expect(existsSync(dbPath)).toBe(false);

    await provider.set({ key: "TEST_KEY" }, "test-value");
    expect(existsSync(dbPath)).toBe(true);
  });

  it("set() and get() round-trip", async () => {
    const provider = createProvider();
    await provider.set({ key: "API_KEY" }, "sk-secret-123");

    const value = await provider.get({ key: "API_KEY" });
    expect(value).toBe("sk-secret-123");
  });

  it("get() returns undefined for nonexistent key", async () => {
    const provider = createProvider();
    // Force DB creation
    await provider.set({ key: "OTHER" }, "val");

    const value = await provider.get({ key: "NONEXISTENT" });
    expect(value).toBeUndefined();
  });

  it("context isolation via groups", async () => {
    const provider = createProvider();

    await provider.set({ key: "KEY", context_id: "work" }, "work-value");
    await provider.set({ key: "KEY", context_id: "personal" }, "personal-value");

    expect(await provider.get({ key: "KEY", context_id: "work" })).toBe("work-value");
    expect(await provider.get({ key: "KEY", context_id: "personal" })).toBe("personal-value");
  });

  it("global keys use _global group", async () => {
    const provider = createProvider();
    await provider.set({ key: "GLOBAL_KEY" }, "global-value");

    const value = await provider.get({ key: "GLOBAL_KEY" });
    expect(value).toBe("global-value");
  });

  it("list() returns key names", async () => {
    const provider = createProvider();
    await provider.set({ key: "A" }, "1");
    await provider.set({ key: "B" }, "2");
    await provider.set({ key: "C" }, "3");

    const keys = await provider.list();
    expect(keys).toEqual(["A", "B", "C"]);
  });

  it("list() scoped to context", async () => {
    const provider = createProvider();
    await provider.set({ key: "CTX_KEY", context_id: "myctx" }, "val");
    await provider.set({ key: "GLOBAL_KEY" }, "val2");

    const ctxKeys = await provider.list("myctx");
    expect(ctxKeys).toEqual(["CTX_KEY"]);

    const globalKeys = await provider.list();
    expect(globalKeys).toEqual(["GLOBAL_KEY"]);
  });

  it("delete() removes an entry", async () => {
    const provider = createProvider();
    await provider.set({ key: "DEL_KEY" }, "to-delete");
    expect(await provider.get({ key: "DEL_KEY" })).toBe("to-delete");

    await provider.delete({ key: "DEL_KEY" });
    expect(await provider.get({ key: "DEL_KEY" })).toBeUndefined();
  });

  it("set() updates existing entry", async () => {
    const provider = createProvider();
    await provider.set({ key: "UPD" }, "old");
    await provider.set({ key: "UPD" }, "new");

    expect(await provider.get({ key: "UPD" })).toBe("new");
    const keys = await provider.list();
    expect(keys.filter((k) => k === "UPD").length).toBe(1);
  });

  it("list() returns empty array when DB doesn't exist", async () => {
    const provider = createProvider();
    const keys = await provider.list();
    expect(keys).toEqual([]);
  });

  it("persistence across provider instances", async () => {
    const p1 = createProvider();
    await p1.set({ key: "PERSIST" }, "survived");

    // Create new instance pointing to same DB
    const p2 = createProvider();
    const value = await p2.get({ key: "PERSIST" });
    expect(value).toBe("survived");
  });
});
