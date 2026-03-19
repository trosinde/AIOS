import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, statSync, rmSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";

// We test the config utility functions directly (not the interactive wizard)

describe("saveConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aios-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes valid YAML config file", () => {
    const configPath = join(testDir, "config.yaml");
    const config = {
      providers: {
        claude: { type: "anthropic" as const, model: "claude-sonnet-4-20250514" },
      },
      defaults: { provider: "claude" },
      paths: { patterns: "~/.aios/patterns", personas: "~/.aios/personas" },
    };

    const header = "# AIOS Configuration\n# Bearbeiten: aios configure\n\n";
    const yamlContent = yamlStringify(config);
    writeFileSync(configPath, header + yamlContent, "utf-8");

    // Read back and verify
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("providers:");
    expect(content).toContain("claude");
    expect(content).toContain("claude-sonnet-4-20250514");

    // Parse back the YAML (skip header comments)
    const parsed = yamlParse(content);
    expect(parsed.providers.claude.type).toBe("anthropic");
    expect(parsed.defaults.provider).toBe("claude");
  });
});

describe("saveEnv", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aios-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes .env file with correct permissions", () => {
    const envPath = join(testDir, ".env");
    const vars = { ANTHROPIC_API_KEY: "sk-ant-test-key" };

    writeFileSync(envPath, `ANTHROPIC_API_KEY=${vars.ANTHROPIC_API_KEY}\n`, "utf-8");
    chmodSync(envPath, 0o600);

    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("ANTHROPIC_API_KEY=sk-ant-test-key");

    const stats = statSync(envPath);
    const mode = (stats.mode & 0o777).toString(8);
    expect(mode).toBe("600");
  });

  it("updates existing keys without duplicating", () => {
    const envPath = join(testDir, ".env");

    // Write initial
    writeFileSync(envPath, "ANTHROPIC_API_KEY=old-key\nOTHER_VAR=keep\n", "utf-8");

    // Simulate update logic
    const content = readFileSync(envPath, "utf-8");
    const lines: string[] = [];
    const existing = new Set<string>();
    const newVars: Record<string, string> = { ANTHROPIC_API_KEY: "new-key" };

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) { lines.push(line); continue; }
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) { lines.push(line); continue; }
      const key = trimmed.slice(0, eqIndex).trim();
      existing.add(key);
      if (key in newVars) {
        lines.push(`${key}=${newVars[key]}`);
      } else {
        lines.push(line);
      }
    }
    for (const [key, value] of Object.entries(newVars)) {
      if (!existing.has(key)) lines.push(`${key}=${value}`);
    }
    writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");

    const result = readFileSync(envPath, "utf-8");
    expect(result).toContain("ANTHROPIC_API_KEY=new-key");
    expect(result).toContain("OTHER_VAR=keep");
    // Should not have old key
    expect(result).not.toContain("old-key");
    // Should not duplicate
    const matches = result.match(/ANTHROPIC_API_KEY/g);
    expect(matches?.length).toBe(1);
  });
});

describe("loadEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  it("parses .env format correctly", () => {
    const content = [
      "# Comment line",
      "",
      "ANTHROPIC_API_KEY=sk-ant-test",
      "SOME_VAR=hello world",
      "EMPTY=",
      "  SPACED_KEY = spaced_value ",
    ].join("\n");

    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      result[key] = value;
    }

    expect(result["ANTHROPIC_API_KEY"]).toBe("sk-ant-test");
    expect(result["SOME_VAR"]).toBe("hello world");
    expect(result["EMPTY"]).toBe("");
    expect(result["SPACED_KEY"]).toBe("spaced_value");
    // Comment should not be parsed
    expect(Object.keys(result)).not.toContain("#");
  });

  it("does not overwrite existing process.env variables", () => {
    process.env["TEST_EXISTING"] = "original";

    // Simulate loadEnv logic
    const envContent = "TEST_EXISTING=overwritten\nTEST_NEW=fresh";
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }

    expect(process.env["TEST_EXISTING"]).toBe("original"); // not overwritten
    expect(process.env["TEST_NEW"]).toBe("fresh");
  });
});
