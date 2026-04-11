/**
 * Mock-based tests for the Azure DevOps MCP proxy wiring.
 *
 * Covers the AzDo-flavoured paths through McpManager that aren't already
 * asserted in `src/core/mcp.test.ts`:
 *   - sensitive env keys are stripped when spawning the child server
 *   - server-local env (AZDO_CONFIG) reaches the child
 *   - `azdo/` prefix + `devops` category propagate end-to-end
 *   - WIQL-style tool call forwards complex args verbatim
 *   - TFS-shaped JSON error blobs are sanitized on the way out
 *   - reconnect-on-stale-transport path is exercised
 *
 * The full end-to-end suite against a real TFS instance lives in
 * `azure-devops.integration.test.ts` and is opt-in via
 * `npm run test:integration` with `AZDO_INTEGRATION=1`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpManager } from "../core/mcp.js";
import type { McpConfig } from "../types.js";

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  listTools: vi.fn(),
  callTool: vi.fn(),
};

const mockTransport = {
  close: vi.fn().mockResolvedValue(undefined),
};

const transportCtor = vi.fn().mockImplementation(() => mockTransport);

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => mockClient),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation((opts) => {
    transportCtor(opts);
    return mockTransport;
  }),
}));

const AZDO_SERVER = "azure-devops";

function azdoConfig(): McpConfig {
  return {
    servers: {
      [AZDO_SERVER]: {
        command: "node",
        args: ["/path/to/mcp-azure-devops/dist/index.js"],
        env: { AZDO_CONFIG: "/etc/aios/azdo-config.json" },
        category: "devops",
        prefix: "azdo",
        description: "Azure DevOps Integration",
      },
    },
  };
}

function azdoToolList() {
  return {
    tools: [
      { name: "ping", description: "Server info", inputSchema: { type: "object", properties: {} } },
      { name: "list_projects", description: "List projects", inputSchema: { type: "object", properties: {} } },
      {
        name: "execute_wiql",
        description: "Run a WIQL query",
        inputSchema: {
          type: "object",
          properties: {
            wiql: { type: "string" },
            project: { type: "string" },
            limit: { type: "number" },
            offset: { type: "number" },
          },
          required: ["wiql", "project"],
        },
      },
      {
        name: "get_work_item",
        description: "Get a work item",
        inputSchema: {
          type: "object",
          properties: { id: { type: "number" }, project: { type: "string" } },
          required: ["id", "project"],
        },
      },
      {
        name: "update_work_item",
        description: "Update a work item",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "number" },
            project: { type: "string" },
            fields: { type: "object" },
          },
          required: ["id", "project", "fields"],
        },
      },
    ],
  };
}

describe("Azure DevOps MCP proxy wiring (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.listTools.mockResolvedValue(azdoToolList());
    mockClient.callTool.mockReset();
  });

  describe("child-process spawn env", () => {
    it("forwards AZDO_CONFIG from serverCfg.env to the child transport", async () => {
      const manager = new McpManager(azdoConfig());
      await manager.connect(AZDO_SERVER);

      expect(transportCtor).toHaveBeenCalledTimes(1);
      const opts = transportCtor.mock.calls[0][0];
      expect(opts.command).toBe("node");
      expect(opts.args).toEqual(["/path/to/mcp-azure-devops/dist/index.js"]);
      expect(opts.env.AZDO_CONFIG).toBe("/etc/aios/azdo-config.json");
    });

    it("strips sensitive keys from process.env before passing to the child", async () => {
      const prev = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET,
        AZDO_INTEGRATION_SAFE: process.env.AZDO_INTEGRATION_SAFE,
      };
      process.env.ANTHROPIC_API_KEY = "sk-ant-secret";
      process.env.GITHUB_TOKEN = "ghp_secret";
      process.env.AZURE_CLIENT_SECRET = "azure-secret";
      process.env.AZDO_INTEGRATION_SAFE = "ok-value";

      try {
        const manager = new McpManager(azdoConfig());
        await manager.connect(AZDO_SERVER);

        const opts = transportCtor.mock.calls[0][0];
        expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(opts.env.GITHUB_TOKEN).toBeUndefined();
        expect(opts.env.AZURE_CLIENT_SECRET).toBeUndefined();
        // Non-sensitive env must pass through
        expect(opts.env.AZDO_INTEGRATION_SAFE).toBe("ok-value");
        // Server-local env wins over process.env for the same key
        expect(opts.env.AZDO_CONFIG).toBe("/etc/aios/azdo-config.json");
      } finally {
        for (const [k, v] of Object.entries(prev)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    });
  });

  describe("tool discovery", () => {
    it("maps all AzDo tools under the azdo/ prefix with devops category", async () => {
      const manager = new McpManager(azdoConfig());
      const tools = await manager.listTools(AZDO_SERVER);

      expect(tools.map((t) => t.patternName)).toEqual([
        "azdo/ping",
        "azdo/list_projects",
        "azdo/execute_wiql",
        "azdo/get_work_item",
        "azdo/update_work_item",
      ]);
      for (const t of tools) {
        expect(t.category).toBe("devops");
        expect(t.serverName).toBe(AZDO_SERVER);
      }
    });

    it("preserves the WIQL input schema so downstream routing can validate args", async () => {
      const manager = new McpManager(azdoConfig());
      const tools = await manager.listTools(AZDO_SERVER);
      const wiql = tools.find((t) => t.name === "execute_wiql");
      expect(wiql).toBeDefined();
      const schema = wiql!.inputSchema as {
        required?: string[];
        properties?: Record<string, { type: string }>;
      };
      expect(schema.required).toEqual(["wiql", "project"]);
      expect(schema.properties?.wiql.type).toBe("string");
      expect(schema.properties?.limit.type).toBe("number");
    });
  });

  describe("tool call forwarding", () => {
    it("passes a WIQL query verbatim to the underlying MCP client", async () => {
      mockClient.callTool.mockResolvedValue({
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({ items: [{ id: 1234 }], totalCount: 1, offset: 0, limit: 5 }),
          },
        ],
      });

      const manager = new McpManager(azdoConfig());
      const wiql = "SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER 'INFRA\\DAX Team'";
      const raw = await manager.callTool(AZDO_SERVER, "execute_wiql", {
        wiql,
        project: "INFRA",
        limit: 5,
        offset: 0,
      });

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: "execute_wiql",
        arguments: { wiql, project: "INFRA", limit: 5, offset: 0 },
      });
      const parsed = JSON.parse(raw) as { totalCount: number };
      expect(parsed.totalCount).toBe(1);
    });

    it("returns list_projects array payload as-is (AzDo server returns an array)", async () => {
      mockClient.callTool.mockResolvedValue({
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify([
              { shortname: "INFRA", baseUrl: "https://tfs/LabTec%20Infrastructure" },
              { shortname: "APPS", baseUrl: "https://tfs/Apps" },
            ]),
          },
        ],
      });

      const manager = new McpManager(azdoConfig());
      const raw = await manager.callTool(AZDO_SERVER, "list_projects", {});
      const projects = JSON.parse(raw) as Array<{ shortname: string }>;
      expect(projects.map((p) => p.shortname)).toEqual(["INFRA", "APPS"]);
    });
  });

  describe("error surface", () => {
    it("sanitizes a TFS JSON error blob from a failed update_work_item", async () => {
      const tfsErrorText = JSON.stringify({
        error: '{"$id":"1","innerException":null,"message":"Work item 999999 does not exist","typeName":"Microsoft.TeamFoundation.WorkItemTracking.Server.Metadata.WorkItemNotFoundException","typeKey":"WorkItemNotFoundException","errorCode":0}',
      });
      mockClient.callTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: tfsErrorText }],
      });

      const manager = new McpManager(azdoConfig());
      await expect(
        manager.callTool(AZDO_SERVER, "update_work_item", {
          id: 999999,
          project: "INFRA",
          fields: { "System.State": "Closed" },
        }),
      ).rejects.toThrow(/Work item 999999 does not exist/);

      // Internal type names must NOT leak
      await expect(
        manager.callTool(AZDO_SERVER, "update_work_item", { id: 999999, project: "INFRA", fields: {} }),
      ).rejects.not.toThrow(/WorkItemNotFoundException/);
    });
  });

  describe("reconnect on stale transport", () => {
    it("recreates the client when a cached connect throws on first use", async () => {
      const manager = new McpManager(azdoConfig());
      // Prime the cache with a successful connect
      await manager.connect(AZDO_SERVER);
      expect(mockClient.connect).toHaveBeenCalledTimes(1);

      // Next callTool: force the reconnect path by making the cached
      // client reject once, then succeed.
      // Note: `connect()` is cached, so we simulate staleness by
      // removing the cached client before the call and arranging
      // connect to fail once and then succeed.
      mockClient.connect
        .mockRejectedValueOnce(new Error("EPIPE: transport closed"))
        .mockResolvedValueOnce(undefined);
      mockClient.callTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "pong" }],
      });

      // Force re-entry into connect() by dropping the cached client.
      // This matches the real "stale transport" scenario where the
      // child process died and the cached client is unusable.
      await manager.removeServer(AZDO_SERVER);
      manager.getConfig().servers[AZDO_SERVER] = azdoConfig().servers[AZDO_SERVER];

      const result = await manager.callTool(AZDO_SERVER, "ping", {});
      expect(result).toBe("pong");
      // One failed connect + one recovery connect = 2 additional calls
      // on top of the initial successful prime (total 3).
      expect(mockClient.connect).toHaveBeenCalledTimes(3);
    });
  });
});
