import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpManager, registerMcpTools } from "./mcp.js";
import type { McpConfig } from "../types.js";
import type { PatternRegistry } from "./registry.js";

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => mockClient),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => mockTransport),
}));

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  listTools: vi.fn().mockResolvedValue({
    tools: [
      {
        name: "get_work_item",
        description: "Get a work item by ID",
        inputSchema: {
          type: "object",
          properties: { id: { type: "number", description: "Work item ID" } },
          required: ["id"],
        },
      },
      {
        name: "list_projects",
        description: "List all projects",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }),
  callTool: vi.fn().mockResolvedValue({
    isError: false,
    content: [{ type: "text", text: "Work item #42: Fix login bug" }],
  }),
};

const mockTransport = {
  close: vi.fn().mockResolvedValue(undefined),
};

function createTestConfig(): McpConfig {
  return {
    servers: {
      "azure-devops": {
        command: "node",
        args: ["/path/to/server.js"],
        category: "devops",
        prefix: "azdo",
        description: "Azure DevOps",
      },
    },
  };
}

describe("McpManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects to a server and caches the client", async () => {
    const manager = new McpManager(createTestConfig());

    const client1 = await manager.connect("azure-devops");
    const client2 = await manager.connect("azure-devops");

    expect(client1).toBe(client2);
    // connect() should only be called once (cached)
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it("throws for unconfigured server", async () => {
    const manager = new McpManager(createTestConfig());
    await expect(manager.connect("nonexistent")).rejects.toThrow("nicht konfiguriert");
  });

  it("listTools maps to McpToolInfo with prefix", async () => {
    const manager = new McpManager(createTestConfig());
    const tools = await manager.listTools("azure-devops");

    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      serverName: "azure-devops",
      name: "get_work_item",
      patternName: "azdo/get_work_item",
      description: "Get a work item by ID",
      category: "devops",
    });
    expect(tools[1].patternName).toBe("azdo/list_projects");
  });

  it("callTool extracts text content", async () => {
    const manager = new McpManager(createTestConfig());
    const result = await manager.callTool("azure-devops", "get_work_item", { id: 42 });

    expect(result).toBe("Work item #42: Fix login bug");
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: "get_work_item",
      arguments: { id: 42 },
    });
  });

  it("callTool throws on error result", async () => {
    mockClient.callTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "Not found" }],
    });

    const manager = new McpManager(createTestConfig());
    await expect(manager.callTool("azure-devops", "get_work_item", { id: 999 }))
      .rejects.toThrow("MCP-Tool");
  });

  it("discoverAllTools returns tools from all servers", async () => {
    const manager = new McpManager(createTestConfig());
    const tools = await manager.discoverAllTools();

    expect(tools).toHaveLength(2);
    expect(tools[0].patternName).toBe("azdo/get_work_item");
  });

  it("shutdown closes all transports", async () => {
    const manager = new McpManager(createTestConfig());
    await manager.connect("azure-devops");
    await manager.shutdown();

    expect(mockTransport.close).toHaveBeenCalled();
  });

  describe("addServer", () => {
    it("discovers tools and makes them callable", async () => {
      const manager = new McpManager({ servers: {} });
      expect(manager.getServerNames()).toHaveLength(0);

      const tools = await manager.addServer("azure-devops", {
        command: "node",
        args: ["/path/to/server.js"],
        category: "devops",
        prefix: "azdo",
      });

      expect(tools).toHaveLength(2);
      expect(tools[0].patternName).toBe("azdo/get_work_item");
      expect(manager.getServerNames()).toContain("azure-devops");
      expect(manager.isConnected("azure-devops")).toBe(true);
    });

    it("with bad config throws and does not corrupt state", async () => {
      mockClient.connect.mockRejectedValueOnce(new Error("Connection refused"));

      const manager = new McpManager({ servers: {} });
      await expect(manager.addServer("bad-server", { command: "nonexistent" }))
        .rejects.toThrow();

      // Server is in config but not connected
      expect(manager.getServerNames()).toContain("bad-server");
      expect(manager.isConnected("bad-server")).toBe(false);
    });
  });

  describe("removeServer", () => {
    it("closes transport and cleans maps", async () => {
      const manager = new McpManager(createTestConfig());
      await manager.connect("azure-devops");
      expect(manager.isConnected("azure-devops")).toBe(true);

      await manager.removeServer("azure-devops");

      expect(mockTransport.close).toHaveBeenCalled();
      expect(manager.isConnected("azure-devops")).toBe(false);
      expect(manager.getServerNames()).not.toContain("azure-devops");
    });

    it("is safe for non-connected servers", async () => {
      const manager = new McpManager(createTestConfig());
      // Don't connect, just remove
      await manager.removeServer("azure-devops");
      expect(manager.getServerNames()).not.toContain("azure-devops");
    });
  });

  describe("getServerNames", () => {
    it("reflects add and remove", async () => {
      const manager = new McpManager(createTestConfig());
      expect(manager.getServerNames()).toEqual(["azure-devops"]);

      await manager.addServer("github", { command: "node", args: ["gh.js"] });
      expect(manager.getServerNames()).toEqual(["azure-devops", "github"]);

      await manager.removeServer("azure-devops");
      expect(manager.getServerNames()).toEqual(["github"]);
    });
  });
});

describe("registerMcpTools", () => {
  it("registers tools as virtual patterns in the registry", () => {
    const registered: Array<{ meta: { name: string } }> = [];
    const mockRegistry = {
      registerVirtual: vi.fn((p) => registered.push(p)),
    } as unknown as PatternRegistry;

    const tools = [
      {
        serverName: "test-server",
        name: "my_tool",
        patternName: "test/my_tool",
        description: "A test tool",
        inputSchema: { type: "object" },
        category: "testing",
      },
    ];

    registerMcpTools(tools, mockRegistry, "test-server");

    expect(mockRegistry.registerVirtual).toHaveBeenCalledTimes(1);
    expect(mockRegistry.registerVirtual).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          name: "test/my_tool",
          type: "mcp",
          mcp_server: "test-server",
          mcp_tool: "my_tool",
        }),
      }),
    );
  });
});
