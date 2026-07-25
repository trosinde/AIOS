import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
  AIOS_SERVER_KEY,
  buildAiosServerEntry,
  mergeServer,
  removeServer,
  readCopilotConfig,
  copilotConfigPath,
  type CopilotMcpConfig,
  type CopilotMcpServer,
} from "./copilot.js";

const fakeAios: CopilotMcpServer = {
  type: "local",
  command: "aios",
  args: ["mcp-server"],
  tools: ["*"],
  env: {},
};

describe("buildAiosServerEntry", () => {
  it("produces a valid local server entry with all tools", () => {
    const entry = buildAiosServerEntry();
    expect(entry.type).toBe("local");
    expect(entry.tools).toEqual(["*"]);
    expect(entry.env).toEqual({});
    expect(entry.args.length).toBeGreaterThan(0);
  });

  it("honors a command override and defaults args to mcp-server", () => {
    const entry = buildAiosServerEntry({ command: "node" });
    expect(entry.command).toBe("node");
    expect(entry.args).toEqual(["mcp-server"]);
  });

  it("parses comma-separated args override", () => {
    const entry = buildAiosServerEntry({ command: "node", args: "/abs/cli.js, mcp-server" });
    expect(entry.args).toEqual(["/abs/cli.js", "mcp-server"]);
  });

  it("accepts an array args override", () => {
    const entry = buildAiosServerEntry({ command: "node", args: ["x", "mcp-server"] });
    expect(entry.args).toEqual(["x", "mcp-server"]);
  });
});

describe("mergeServer", () => {
  it("creates config from scratch when none exists", () => {
    const merged = mergeServer(undefined, AIOS_SERVER_KEY, fakeAios);
    expect(merged.mcpServers[AIOS_SERVER_KEY]).toEqual(fakeAios);
  });

  it("preserves foreign servers (non-destructive)", () => {
    const existing: CopilotMcpConfig = {
      mcpServers: {
        github: { type: "local", command: "gh-mcp", args: [], tools: ["*"], env: {} },
      },
      $schema: "https://example/schema.json",
    };
    const merged = mergeServer(existing, AIOS_SERVER_KEY, fakeAios);
    expect(merged.mcpServers.github).toBeDefined();
    expect(merged.mcpServers[AIOS_SERVER_KEY]).toEqual(fakeAios);
    // unrelated top-level keys survive
    expect(merged.$schema).toBe("https://example/schema.json");
  });

  it("is idempotent for the same entry", () => {
    const once = mergeServer(undefined, AIOS_SERVER_KEY, fakeAios);
    const twice = mergeServer(once, AIOS_SERVER_KEY, fakeAios);
    expect(twice).toEqual(once);
  });

  it("does not mutate the input object", () => {
    const existing: CopilotMcpConfig = { mcpServers: {} };
    mergeServer(existing, AIOS_SERVER_KEY, fakeAios);
    expect(existing.mcpServers[AIOS_SERVER_KEY]).toBeUndefined();
  });
});

describe("removeServer", () => {
  it("removes only the aios entry", () => {
    const existing: CopilotMcpConfig = {
      mcpServers: {
        [AIOS_SERVER_KEY]: fakeAios,
        github: { type: "local", command: "gh-mcp", args: [], tools: ["*"], env: {} },
      },
    };
    const next = removeServer(existing, AIOS_SERVER_KEY);
    expect(next.mcpServers[AIOS_SERVER_KEY]).toBeUndefined();
    expect(next.mcpServers.github).toBeDefined();
  });

  it("handles missing config gracefully", () => {
    expect(removeServer(undefined, AIOS_SERVER_KEY)).toEqual({ mcpServers: {} });
  });
});

describe("readCopilotConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `aios-copilot-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns undefined when file is absent", () => {
    expect(readCopilotConfig(join(dir, "nope.json"))).toBeUndefined();
  });

  it("returns undefined for an empty file", () => {
    const p = join(dir, "mcp-config.json");
    writeFileSync(p, "   ");
    expect(readCopilotConfig(p)).toBeUndefined();
  });

  it("parses a valid config", () => {
    const p = join(dir, "mcp-config.json");
    writeFileSync(p, JSON.stringify({ mcpServers: { github: {} } }));
    const cfg = readCopilotConfig(p);
    expect(cfg?.mcpServers.github).toBeDefined();
  });

  it("normalizes missing mcpServers to an empty object", () => {
    const p = join(dir, "mcp-config.json");
    writeFileSync(p, JSON.stringify({ other: true }));
    const cfg = readCopilotConfig(p);
    expect(cfg?.mcpServers).toEqual({});
  });

  it("throws a clear error on corrupt JSON instead of losing data", () => {
    const p = join(dir, "mcp-config.json");
    writeFileSync(p, "{ not json ]]]");
    expect(() => readCopilotConfig(p)).toThrow(/gültiges JSON/);
  });

  it("round-trips a merge through disk preserving foreign servers", () => {
    const p = join(dir, "mcp-config.json");
    writeFileSync(p, JSON.stringify({ mcpServers: { github: { type: "local", command: "x", args: [], tools: ["*"], env: {} } } }));
    const existing = readCopilotConfig(p);
    const merged = mergeServer(existing, AIOS_SERVER_KEY, fakeAios);
    writeFileSync(p, JSON.stringify(merged, null, 2));
    const reread = readCopilotConfig(p);
    expect(reread?.mcpServers.github).toBeDefined();
    expect(reread?.mcpServers[AIOS_SERVER_KEY]).toEqual(fakeAios);
  });
});

describe("copilotConfigPath", () => {
  const orig = process.env.COPILOT_HOME;
  afterEach(() => {
    if (orig === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = orig;
  });

  it("respects COPILOT_HOME", () => {
    process.env.COPILOT_HOME = "/custom/copilot";
    expect(copilotConfigPath()).toBe(join("/custom/copilot", "mcp-config.json"));
  });

  it("falls back to ~/.copilot when COPILOT_HOME is unset", () => {
    delete process.env.COPILOT_HOME;
    expect(copilotConfigPath()).toMatch(/[\\/]\.copilot[\\/]mcp-config\.json$/);
  });
});
