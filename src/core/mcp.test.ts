import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpManager, registerMcpTools, sanitizeErrorMessage, extractTextContent } from "./mcp.js";
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

describe("sanitizeErrorMessage", () => {
  it("returns fallback for empty input", () => {
    expect(sanitizeErrorMessage("")).toBe("Unbekannter Fehler");
  });

  it("returns fallback for whitespace-only input", () => {
    expect(sanitizeErrorMessage("   \n\t  ")).toBe("Unbekannter Fehler");
  });

  it("passes short plain messages through", () => {
    expect(sanitizeErrorMessage("Something broke")).toBe("Something broke");
  });

  it("strips Unix file paths with line numbers", () => {
    const msg = "Error at /home/user/project/src/app.ts:42:13 failed";
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("/home/user");
    expect(result).toContain("[path]");
  });

  it("strips Windows file paths", () => {
    const msg = "Error at C:\\Users\\me\\app.ts:42:13";
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("C:\\Users");
    expect(result).toContain("[path]");
  });

  it("strips stack trace lines", () => {
    const msg = "Top-level error\n    at foo (bar.js:1:1)\n    at main (x.js:2:2)";
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("at foo");
    expect(result).not.toContain("at main");
    expect(result).toContain("Top-level error");
  });

  it("extracts human message from JSON TFS error format", () => {
    const msg = JSON.stringify({
      error: '{"$id":"1","innerException":null,"message":"Work item 123 not found","typeName":"Foo"}',
    });
    expect(sanitizeErrorMessage(msg)).toContain("Work item 123 not found");
  });

  it("handles malformed JSON gracefully", () => {
    const result = sanitizeErrorMessage('{"error": not valid json');
    expect(result).toBeTruthy();
    expect(result).not.toBe("Unbekannter Fehler");
  });

  it("handles JSON with non-string error field", () => {
    const msg = JSON.stringify({ error: { code: 500 } });
    // Falls through to path-stripping path since error isn't a string
    expect(sanitizeErrorMessage(msg)).toBeTruthy();
  });
});

describe("extractTextContent", () => {
  it("returns empty string for non-array", () => {
    expect(extractTextContent(null)).toBe("");
    expect(extractTextContent(undefined)).toBe("");
    expect(extractTextContent("oops")).toBe("");
    expect(extractTextContent({})).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(extractTextContent([])).toBe("");
  });

  it("joins text blocks with newlines", () => {
    const content = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];
    expect(extractTextContent(content)).toBe("first\nsecond");
  });

  it("skips non-text blocks", () => {
    const content = [
      { type: "text", text: "keep" },
      { type: "image", data: "..." },
      { type: "text", text: "also keep" },
    ];
    expect(extractTextContent(content)).toBe("keep\nalso keep");
  });

  it("skips malformed blocks (null, missing fields, wrong types)", () => {
    const content = [
      null,
      { type: "text" }, // missing text
      { type: "text", text: 42 }, // wrong type
      { type: "text", text: "valid" },
      undefined,
    ];
    expect(extractTextContent(content)).toBe("valid");
  });

  it("does not trip on prototype-pollution-shaped input", () => {
    const content = [
      { type: "text", text: "safe", __proto__: { polluted: true } },
    ];
    expect(extractTextContent(content)).toBe("safe");
    // Object.prototype should not have been polluted
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
