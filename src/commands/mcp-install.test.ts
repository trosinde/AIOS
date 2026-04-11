import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { McpServerConfig } from "../types.js";

// ─── Mock child_process.spawn ──────────────────────────────
//
// Each test can stub a map of { command+args → { code, stdout, stderr } }.
// The mock spawn returns a fake ChildProcess that emits data + close
// events on the next microtask.

interface MockResponse {
  code?: number;
  stdout?: string;
  stderr?: string;
  errorOnSpawn?: string;
}

const commandResponses = new Map<string, MockResponse>();

function keyFor(cmd: string, args: readonly string[]): string {
  return [cmd, ...args].join(" ");
}

vi.mock("child_process", () => ({
  spawn: (cmd: string, args: string[]) => {
    const key = keyFor(cmd, args ?? []);
    const response = commandResponses.get(key) ?? { code: 0 };
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { /* noop */ };

    // Emit asynchronously so listeners are attached first
    queueMicrotask(() => {
      if (response.errorOnSpawn) {
        child.emit("error", new Error(response.errorOnSpawn));
        return;
      }
      if (response.stdout) {
        child.stdout.emit("data", Buffer.from(response.stdout));
      }
      if (response.stderr) {
        child.stderr.emit("data", Buffer.from(response.stderr));
      }
      child.emit("close", response.code ?? 0);
    });

    return child;
  },
}));

// Import AFTER the mock is set up
const {
  isToolAvailable,
  runCommand,
  isServerInstalled,
  pickInstallMethod,
  installServer,
  installMcpServers,
  resolveServers,
  formatResult,
} = await import("./mcp-install.js");

beforeEach(() => {
  commandResponses.clear();
});

afterEach(() => {
  commandResponses.clear();
});

// ─── runCommand ────────────────────────────────────────────

describe("runCommand", () => {
  it("returns exit code 0 and captured stdout for a successful command", async () => {
    commandResponses.set("echo hello", { code: 0, stdout: "hello\n" });
    const result = await runCommand(["echo", "hello"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
  });

  it("returns non-zero code and stderr on failure", async () => {
    commandResponses.set("false", { code: 1, stderr: "boom" });
    const result = await runCommand(["false"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("boom");
  });

  it("handles spawn errors (ENOENT) gracefully", async () => {
    commandResponses.set("nonexistent-binary", { errorOnSpawn: "ENOENT" });
    const result = await runCommand(["nonexistent-binary"]);
    expect(result.code).toBe(127);
    expect(result.stderr).toContain("ENOENT");
  });

  it("returns code 1 for empty argv", async () => {
    const result = await runCommand([]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("empty command");
  });
});

// ─── isToolAvailable ───────────────────────────────────────

describe("isToolAvailable", () => {
  const whichCmd = process.platform === "win32" ? "where" : "which";

  it("returns true when `which` exits 0", async () => {
    commandResponses.set(`${whichCmd} uv`, { code: 0 });
    expect(await isToolAvailable("uv")).toBe(true);
  });

  it("returns false when `which` exits non-zero", async () => {
    commandResponses.set(`${whichCmd} nonexistent`, { code: 1 });
    expect(await isToolAvailable("nonexistent")).toBe(false);
  });

  it("returns false when spawn errors", async () => {
    commandResponses.set(`${whichCmd} bad`, { errorOnSpawn: "ENOENT" });
    expect(await isToolAvailable("bad")).toBe(false);
  });
});

// ─── isServerInstalled ─────────────────────────────────────

describe("isServerInstalled", () => {
  it("returns true when install_detect is absent (optimistic default)", async () => {
    const cfg: McpServerConfig = { command: "x" };
    expect(await isServerInstalled(cfg)).toBe(true);
  });

  it("returns true when install_detect exits 0", async () => {
    commandResponses.set("python -c import mempalace", { code: 0 });
    const cfg: McpServerConfig = {
      command: "python",
      install_detect: ["python", "-c", "import mempalace"],
    };
    expect(await isServerInstalled(cfg)).toBe(true);
  });

  it("returns false when install_detect exits non-zero", async () => {
    commandResponses.set("python -c import mempalace", { code: 1, stderr: "ModuleNotFoundError" });
    const cfg: McpServerConfig = {
      command: "python",
      install_detect: ["python", "-c", "import mempalace"],
    };
    expect(await isServerInstalled(cfg)).toBe(false);
  });

  it("returns true when install_detect is empty array", async () => {
    const cfg: McpServerConfig = { command: "x", install_detect: [] };
    expect(await isServerInstalled(cfg)).toBe(true);
  });
});

// ─── pickInstallMethod ─────────────────────────────────────

describe("pickInstallMethod", () => {
  const whichCmd = process.platform === "win32" ? "where" : "which";

  it("returns undefined when commands array is empty", async () => {
    expect(await pickInstallMethod([])).toBeUndefined();
    expect(await pickInstallMethod(undefined)).toBeUndefined();
  });

  it("picks the first available method in order", async () => {
    commandResponses.set(`${whichCmd} uv`, { code: 0 });
    commandResponses.set(`${whichCmd} pipx`, { code: 0 });
    const method = await pickInstallMethod([
      { detect: "uv", run: ["uv", "install", "x"] },
      { detect: "pipx", run: ["pipx", "install", "x"] },
    ]);
    expect(method?.detect).toBe("uv");
  });

  it("skips methods whose detect tool is missing", async () => {
    commandResponses.set(`${whichCmd} uv`, { code: 1 });
    commandResponses.set(`${whichCmd} pipx`, { code: 0 });
    const method = await pickInstallMethod([
      { detect: "uv", run: ["uv", "install", "x"] },
      { detect: "pipx", run: ["pipx", "install", "x"] },
    ]);
    expect(method?.detect).toBe("pipx");
  });

  it("returns undefined when no method is available", async () => {
    commandResponses.set(`${whichCmd} uv`, { code: 1 });
    commandResponses.set(`${whichCmd} pipx`, { code: 1 });
    const method = await pickInstallMethod([
      { detect: "uv", run: ["uv", "install", "x"] },
      { detect: "pipx", run: ["pipx", "install", "x"] },
    ]);
    expect(method).toBeUndefined();
  });

  it("skips malformed commands (missing detect/run)", async () => {
    commandResponses.set(`${whichCmd} pipx`, { code: 0 });
    const method = await pickInstallMethod([
      { detect: "", run: ["x"] },
      { detect: "broken", run: [] },
      { detect: "pipx", run: ["pipx", "install", "x"] },
    ]);
    expect(method?.detect).toBe("pipx");
  });
});

// ─── installServer ─────────────────────────────────────────

describe("installServer", () => {
  const whichCmd = process.platform === "win32" ? "where" : "which";

  const mempalaceCfg: McpServerConfig = {
    command: "python",
    args: ["-m", "mempalace.mcp_server"],
    install_detect: ["python", "-c", "import mempalace"],
    install_hint: "pipx install mempalace",
    install_commands: [
      { detect: "uv", run: ["uv", "tool", "install", "mempalace"] },
      { detect: "pipx", run: ["pipx", "install", "mempalace"] },
    ],
  };

  it("returns already_installed when detect succeeds", async () => {
    commandResponses.set("python -c import mempalace", { code: 0 });
    const result = await installServer("mempalace", mempalaceCfg, { nonInteractive: true });
    expect(result.status).toBe("already_installed");
    expect(result.ok).toBe(true);
  });

  it("returns no_install_detect when detect is missing (nothing to verify)", async () => {
    const cfg: McpServerConfig = { command: "x" };
    const result = await installServer("x", cfg, { nonInteractive: true });
    expect(result.status).toBe("no_install_detect");
    expect(result.ok).toBe(true);
  });

  it("returns install_failed in check-only mode when not installed", async () => {
    commandResponses.set("python -c import mempalace", { code: 1 });
    const result = await installServer("mempalace", mempalaceCfg, {
      check: true,
      nonInteractive: true,
    });
    expect(result.status).toBe("install_failed");
    expect(result.ok).toBe(false);
    expect(result.hint).toBe("pipx install mempalace");
  });

  it("installs via the first available method (uv preferred over pipx)", async () => {
    commandResponses.set("python -c import mempalace", { code: 1 });
    commandResponses.set(`${whichCmd} uv`, { code: 0 });
    commandResponses.set(`${whichCmd} pipx`, { code: 0 });
    commandResponses.set("uv tool install mempalace", { code: 0, stdout: "installed" });
    // After install, detect succeeds
    // Note: the same key is reused for step 1 and step 7 (verify). We need
    // a toggling mock. Let's use a call counter pattern instead.
    let detectCalls = 0;
    commandResponses.set("python -c import mempalace", {
      get code() {
        detectCalls++;
        return detectCalls === 1 ? 1 : 0;
      },
    } as unknown as MockResponse);

    const result = await installServer("mempalace", mempalaceCfg, {
      nonInteractive: true,
    });
    expect(result.status).toBe("installed");
    expect(result.ok).toBe(true);
    expect(result.via).toBe("uv");
    expect(detectCalls).toBe(2);
  });

  it("falls back to pipx when uv is unavailable", async () => {
    let detectCalls = 0;
    commandResponses.set("python -c import mempalace", {
      get code() {
        detectCalls++;
        return detectCalls === 1 ? 1 : 0;
      },
    } as unknown as MockResponse);
    commandResponses.set(`${whichCmd} uv`, { code: 1 });
    commandResponses.set(`${whichCmd} pipx`, { code: 0 });
    commandResponses.set("pipx install mempalace", { code: 0 });

    const result = await installServer("mempalace", mempalaceCfg, {
      nonInteractive: true,
    });
    expect(result.status).toBe("installed");
    expect(result.via).toBe("pipx");
  });

  it("returns no_method when no install tool is available", async () => {
    commandResponses.set("python -c import mempalace", { code: 1 });
    commandResponses.set(`${whichCmd} uv`, { code: 1 });
    commandResponses.set(`${whichCmd} pipx`, { code: 1 });

    const result = await installServer("mempalace", mempalaceCfg, {
      nonInteractive: true,
    });
    expect(result.status).toBe("no_method");
    expect(result.ok).toBe(false);
    expect(result.hint).toBe("pipx install mempalace");
  });

  it("returns install_failed when the install command exits non-zero", async () => {
    commandResponses.set("python -c import mempalace", { code: 1 });
    commandResponses.set(`${whichCmd} uv`, { code: 1 });
    commandResponses.set(`${whichCmd} pipx`, { code: 0 });
    commandResponses.set("pipx install mempalace", {
      code: 1,
      stderr: "Package 'mempalace' not found",
    });

    const result = await installServer("mempalace", mempalaceCfg, {
      nonInteractive: true,
    });
    expect(result.status).toBe("install_failed");
    expect(result.ok).toBe(false);
    expect(result.via).toBe("pipx");
    expect(result.error).toContain("mempalace");
  });

  it("runs post_install after successful install", async () => {
    let detectCalls = 0;
    commandResponses.set("python -c import mempalace", {
      get code() {
        detectCalls++;
        return detectCalls === 1 ? 1 : 0;
      },
    } as unknown as MockResponse);
    commandResponses.set(`${whichCmd} pipx`, { code: 0 });
    commandResponses.set("pipx install mempalace", { code: 0 });
    commandResponses.set("python -m mempalace init", { code: 0, stdout: "initialized" });

    const cfg: McpServerConfig = {
      ...mempalaceCfg,
      install_commands: [{ detect: "pipx", run: ["pipx", "install", "mempalace"] }],
      post_install: ["python", "-m", "mempalace", "init"],
    };
    const result = await installServer("mempalace", cfg, { nonInteractive: true });
    expect(result.status).toBe("installed");
    expect(result.ok).toBe(true);
  });

  it("reports post_install_failed but still marks ok=true (package is installed)", async () => {
    commandResponses.set("python -c import mempalace", { code: 1 });
    commandResponses.set(`${whichCmd} pipx`, { code: 0 });
    commandResponses.set("pipx install mempalace", { code: 0 });
    commandResponses.set("python -m mempalace init", { code: 1, stderr: "already initialized" });

    const cfg: McpServerConfig = {
      ...mempalaceCfg,
      install_commands: [{ detect: "pipx", run: ["pipx", "install", "mempalace"] }],
      post_install: ["python", "-m", "mempalace", "init"],
    };
    const result = await installServer("mempalace", cfg, { nonInteractive: true });
    expect(result.status).toBe("post_install_failed");
    expect(result.ok).toBe(true); // package installed, only init step failed
    expect(result.error).toContain("already initialized");
  });

  it("returns install_failed when install reports success but verify still fails", async () => {
    commandResponses.set("python -c import mempalace", { code: 1 });
    commandResponses.set(`${whichCmd} pipx`, { code: 0 });
    commandResponses.set("pipx install mempalace", { code: 0 });
    // Second detect call also fails (verify)

    const cfg: McpServerConfig = {
      ...mempalaceCfg,
      install_commands: [{ detect: "pipx", run: ["pipx", "install", "mempalace"] }],
    };
    const result = await installServer("mempalace", cfg, { nonInteractive: true });
    expect(result.status).toBe("install_failed");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("install_detect still fails");
  });
});

// ─── resolveServers ────────────────────────────────────────

describe("resolveServers", () => {
  const servers: Record<string, McpServerConfig> = {
    mempalace: {
      command: "python",
      install_commands: [{ detect: "pipx", run: ["pipx", "install", "mempalace"] }],
    },
    azure: { command: "node", args: ["azdo.js"] },
    github: {
      command: "node",
      install_commands: [{ detect: "npm", run: ["npm", "install", "-g", "gh-mcp"] }],
    },
  };

  it("returns all servers when server option is undefined", () => {
    const entries = resolveServers(servers, {});
    expect(entries.map(([n]) => n).sort()).toEqual(["azure", "github", "mempalace"]);
  });

  it("returns a single server when server option is set", () => {
    const entries = resolveServers(servers, { server: "mempalace" });
    expect(entries).toHaveLength(1);
    expect(entries[0][0]).toBe("mempalace");
  });

  it("returns empty array for unknown server", () => {
    const entries = resolveServers(servers, { server: "nonexistent" });
    expect(entries).toEqual([]);
  });

  it("filters to only installable servers when onlyInstallable is set", () => {
    const entries = resolveServers(servers, { onlyInstallable: true });
    expect(entries.map(([n]) => n).sort()).toEqual(["github", "mempalace"]);
    expect(entries.find(([n]) => n === "azure")).toBeUndefined();
  });

  it("returns empty when server filter matches nothing + onlyInstallable", () => {
    const entries = resolveServers(servers, { server: "azure", onlyInstallable: true });
    expect(entries).toEqual([]);
  });
});

// ─── installMcpServers (integration) ───────────────────────

describe("installMcpServers", () => {
  it("returns empty array when no servers configured", async () => {
    const results = await installMcpServers({}, {});
    expect(results).toEqual([]);
  });

  it("returns empty array when unknown server requested", async () => {
    const results = await installMcpServers({ azure: { command: "node" } }, {
      server: "nonexistent",
    });
    expect(results).toEqual([]);
  });

  it("processes each server in sequence and collects results", async () => {
    commandResponses.set("python -c import mempalace", { code: 0 });

    const servers: Record<string, McpServerConfig> = {
      mempalace: {
        command: "python",
        install_detect: ["python", "-c", "import mempalace"],
      },
      noinstall: {
        command: "node",
        args: ["server.js"],
      },
    };
    const results = await installMcpServers(servers, { nonInteractive: true });
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("already_installed");
    expect(results[1].status).toBe("no_install_detect");
  });

  it("respects onlyInstallable filter (skips servers without install_commands)", async () => {
    commandResponses.set("python -c import mempalace", { code: 0 });

    const servers: Record<string, McpServerConfig> = {
      mempalace: {
        command: "python",
        install_detect: ["python", "-c", "import mempalace"],
        install_commands: [{ detect: "pipx", run: ["pipx", "install", "mempalace"] }],
      },
      azure: { command: "node" },
    };
    const results = await installMcpServers(servers, {
      onlyInstallable: true,
      nonInteractive: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0].server).toBe("mempalace");
  });
});

// ─── formatResult ──────────────────────────────────────────

describe("formatResult", () => {
  it("formats already_installed with checkmark", () => {
    const out = formatResult({
      server: "mempalace",
      status: "already_installed",
      ok: true,
    });
    expect(out).toContain("mempalace");
    expect(out).toContain("bereits installiert");
  });

  it("formats installed with method name", () => {
    const out = formatResult({
      server: "mempalace",
      status: "installed",
      via: "pipx",
      ok: true,
    });
    expect(out).toContain("installiert via pipx");
  });

  it("formats install_failed with error detail and hint", () => {
    const out = formatResult({
      server: "mempalace",
      status: "install_failed",
      via: "pipx",
      error: "network error",
      hint: "retry later",
      ok: false,
    });
    expect(out).toContain("fehlgeschlagen");
    expect(out).toContain("network error");
    expect(out).toContain("retry later");
  });

  it("formats no_method with hint", () => {
    const out = formatResult({
      server: "mempalace",
      status: "no_method",
      hint: "pipx install mempalace",
      ok: false,
    });
    expect(out).toContain("keine verfügbare Install-Methode");
    expect(out).toContain("pipx install mempalace");
  });

  it("formats skipped_by_user with hint", () => {
    const out = formatResult({
      server: "mempalace",
      status: "skipped_by_user",
      hint: "pipx install mempalace",
      ok: false,
    });
    expect(out).toContain("übersprungen");
    expect(out).toContain("pipx install mempalace");
  });

  it("formats post_install_failed with warning", () => {
    const out = formatResult({
      server: "mempalace",
      status: "post_install_failed",
      via: "pipx",
      error: "init failed",
      ok: true,
    });
    expect(out).toContain("post_install fehlgeschlagen");
    expect(out).toContain("init failed");
  });

  it("formats no_install_detect as neutral note", () => {
    const out = formatResult({
      server: "plain",
      status: "no_install_detect",
      ok: true,
    });
    expect(out).toContain("kein install_detect");
  });
});
