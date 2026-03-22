import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { ServiceBus } from "./service-bus.js";

const TMP = join(process.cwd(), "tmp-test-servicebus");
const DB_PATH = join(TMP, "services.db");

// Mock the registry to return our test context
vi.mock("../context/registry.js", () => ({
  readRegistry: () => ({
    contexts: [
      {
        name: "hr",
        path: join(process.cwd(), "tmp-test-servicebus", "hr-ctx"),
        type: "team",
        description: "HR Team",
        capabilities: [],
        last_updated: new Date().toISOString(),
      },
    ],
  }),
}));

// Mock manifest reader
vi.mock("../context/manifest.js", () => ({
  readManifest: () => ({
    name: "hr",
    config: { default_provider: "test" },
    permissions: { allow_ipc: true },
  }),
  assertPathWithinBase: () => {},
}));

// Mock config
vi.mock("../utils/config.js", () => ({
  loadConfig: () => ({
    defaults: { provider: "test" },
    providers: {},
  }),
  getAiosHome: () => join(process.cwd(), "tmp-test-servicebus"),
}));

beforeEach(() => {
  mkdirSync(join(TMP, "hr-ctx", ".aios"), { recursive: true });
  mkdirSync(join(TMP, "hr-ctx", "data"), { recursive: true });
  writeFileSync(
    join(TMP, "hr-ctx", "data", "employees.json"),
    JSON.stringify([
      { name: "Max", department: "Engineering" },
      { name: "Lisa", department: "HR" },
    ]),
  );
  writeFileSync(
    join(TMP, "hr-ctx", "data", "manifest.yaml"),
    `version: "1.0"
sources:
  - file: employees.json
    name: employees
    description: "Mitarbeiter"
    key_fields: [name, department]
`,
  );
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("ServiceBus", () => {
  it("creates database and tables", () => {
    const bus = new ServiceBus(DB_PATH);
    expect(existsSync(DB_PATH)).toBe(true);
    bus.close();
  });

  it("discovers all endpoints", () => {
    const bus = new ServiceBus(DB_PATH);
    const endpoints = bus.discoverAll();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].name).toBe("employees");
    expect(endpoints[0].context).toBe("hr");
    bus.close();
  });

  it("discovers endpoints for a specific context", () => {
    const bus = new ServiceBus(DB_PATH);
    const endpoints = bus.discoverForContext("hr");
    expect(endpoints).toHaveLength(1);
    bus.close();
  });

  it("returns empty for unknown context", () => {
    const bus = new ServiceBus(DB_PATH);
    const endpoints = bus.discoverForContext("nonexistent");
    expect(endpoints).toEqual([]);
    bus.close();
  });

  it("calls service endpoint with direct search", async () => {
    const bus = new ServiceBus(DB_PATH);
    const ctx = { trace_id: "test-trace", context_id: "cli", started_at: Date.now() };

    const result = await bus.call("hr", "employees", { name: "Max" }, ctx);
    expect(result.method).toBe("direct");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Max");
    bus.close();
  });

  it("tracks request history", async () => {
    const bus = new ServiceBus(DB_PATH);
    const ctx = { trace_id: "test-trace", context_id: "cli", started_at: Date.now() };

    await bus.call("hr", "employees", { name: "Max" }, ctx);
    const history = bus.getHistory(ctx);
    expect(history).toHaveLength(1);
    expect(history[0].endpoint).toBe("employees");
    expect(history[0].status).toBe("completed");
    bus.close();
  });

  it("throws on unknown endpoint", async () => {
    const bus = new ServiceBus(DB_PATH);
    const ctx = { trace_id: "test-trace", context_id: "cli", started_at: Date.now() };

    await expect(bus.call("hr", "nonexistent", {}, ctx)).rejects.toThrow("nicht im Kontext");
    bus.close();
  });

  it("close() can be called safely", () => {
    const bus = new ServiceBus(DB_PATH);
    bus.close();
    // Should not throw on double close
  });
});
