import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpConfig, McpServerConfig } from "../types.js";
import type { PatternRegistry } from "./registry.js";

/**
 * Sanitize error messages from downstream MCP servers.
 * Strips stack traces, file paths, and internal identifiers
 * to prevent information disclosure.
 */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "Unbekannter Fehler";

  // Try to extract the useful message from JSON error responses
  try {
    const parsed = JSON.parse(msg);
    if (parsed.error && typeof parsed.error === "string") {
      // Extract just the human-readable message from TFS error format
      const match = parsed.error.match(/"message":"([^"]+)"/);
      if (match) return match[1];
      // Strip internal type names and stack traces
      return parsed.error
        .replace(/\{[^}]*"typeName":[^}]*\}/g, "")
        .replace(/,"typeKey":[^,}]*/g, "")
        .replace(/,"errorCode":\d+/g, "")
        .replace(/\{"\$id":"\d+",?"innerException":null,?"message":"/g, "")
        .replace(/"\}$/g, "")
        .trim();
    }
  } catch { /* not JSON, use as-is */ }

  // Strip file paths (Unix and Windows)
  let sanitized = msg.replace(/(?:\/[\w.-]+)+\.\w+(?::\d+(?::\d+)?)?/g, "[path]");
  sanitized = sanitized.replace(/[A-Z]:\\[\w\\.-]+\.\w+(?::\d+(?::\d+)?)?/g, "[path]");
  // Strip stack traces (lines starting with "at ")
  sanitized = sanitized.replace(/\n\s*at .+/g, "");

  return sanitized.trim() || "Unbekannter Fehler";
}

/**
 * Extract text from an MCP tool response content array.
 * Defensive: MCP SDK types `content` loosely (unknown shape at runtime),
 * so we type-guard every block before accessing `.text`.
 */
export function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      block !== null &&
      typeof block === "object" &&
      "type" in block &&
      (block as { type: unknown }).type === "text" &&
      "text" in block &&
      typeof (block as { text: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

export interface McpToolInfo {
  serverName: string;
  name: string;
  patternName: string;
  description: string;
  inputSchema: object;
  category: string;
}

/**
 * McpManager – verwaltet MCP-Server-Verbindungen und Tool-Aufrufe.
 * Spawnt Server-Prozesse lazy, cached Clients pro Server.
 */
export class McpManager {
  private clients = new Map<string, Client>();
  private transports = new Map<string, StdioClientTransport>();

  constructor(private config: McpConfig) {}

  /** Aktuellen Config-Snapshot liefern */
  getConfig(): McpConfig {
    return this.config;
  }

  /** Lazy-connect zu einem MCP-Server (cached) */
  async connect(serverName: string): Promise<Client> {
    const existing = this.clients.get(serverName);
    if (existing) return existing;

    const serverCfg = this.config.servers[serverName];
    if (!serverCfg) throw new Error(`MCP-Server "${serverName}" nicht konfiguriert`);

    // Build env with sensitive keys stripped (defense-in-depth)
    const SENSITIVE_ENV_KEYS = [
      "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_API_KEY",
      "AWS_SECRET_ACCESS_KEY", "AZURE_CLIENT_SECRET", "GH_TOKEN",
      "GITHUB_TOKEN", "NPM_TOKEN",
    ];
    const baseEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (SENSITIVE_ENV_KEYS.includes(k)) continue;
      if (typeof v === "string") baseEnv[k] = v;
    }
    const childEnv = serverCfg.env ? { ...baseEnv, ...serverCfg.env } : baseEnv;

    const transport = new StdioClientTransport({
      command: serverCfg.command,
      args: serverCfg.args,
      env: childEnv,
    });

    const client = new Client({ name: "aios", version: "0.1.0" });
    await client.connect(transport);

    this.clients.set(serverName, client);
    this.transports.set(serverName, transport);
    return client;
  }

  /** Tools eines Servers auflisten */
  async listTools(serverName: string): Promise<McpToolInfo[]> {
    const client = await this.connect(serverName);
    const serverCfg = this.config.servers[serverName];
    const prefix = serverCfg.prefix ?? serverName;
    const category = serverCfg.category ?? "mcp";

    const result = await client.listTools();

    return result.tools.map((tool) => ({
      serverName,
      name: tool.name,
      patternName: `${prefix}/${tool.name}`,
      description: tool.description ?? "",
      inputSchema: (tool.inputSchema as object) ?? {},
      category,
    }));
  }

  /** MCP-Tool aufrufen */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    let client: Client;
    try {
      client = await this.connect(serverName);
    } catch {
      // Reconnect bei Verbindungsfehler
      this.clients.delete(serverName);
      this.transports.delete(serverName);
      client = await this.connect(serverName);
    }

    const result = await client.callTool({ name: toolName, arguments: args });
    const textContent = extractTextContent(result.content);

    if (result.isError) {
      throw new Error(`MCP-Tool "${toolName}" Fehler: ${sanitizeErrorMessage(textContent)}`);
    }

    return textContent;
  }

  /** Alle Tools aller konfigurierten Server entdecken */
  async discoverAllTools(): Promise<McpToolInfo[]> {
    const allTools: McpToolInfo[] = [];
    for (const serverName of Object.keys(this.config.servers)) {
      try {
        const tools = await this.listTools(serverName);
        allTools.push(...tools);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`  ⚠️  MCP-Server "${serverName}" nicht erreichbar: ${errMsg}`);
      }
    }
    return allTools;
  }

  /** Server zur Laufzeit hinzufügen und Tools entdecken */
  async addServer(name: string, config: McpServerConfig): Promise<McpToolInfo[]> {
    this.config.servers[name] = config;
    return this.listTools(name);
  }

  /** Server entfernen und Verbindung schließen */
  async removeServer(name: string): Promise<void> {
    const transport = this.transports.get(name);
    if (transport) {
      try {
        await transport.close();
      } catch { /* ignore */ }
      this.transports.delete(name);
      this.clients.delete(name);
    }
    delete this.config.servers[name];
  }

  /** Konfigurierte Server-Namen auflisten */
  getServerNames(): string[] {
    return Object.keys(this.config.servers);
  }

  /** Server-Konfiguration abrufen */
  getServerConfig(name: string): McpServerConfig | undefined {
    return this.config.servers[name];
  }

  /** Prüft ob ein Server verbunden ist */
  isConnected(name: string): boolean {
    return this.clients.has(name);
  }

  /** Alle Verbindungen schließen */
  async shutdown(): Promise<void> {
    for (const [name, transport] of this.transports) {
      try {
        await transport.close();
      } catch { /* ignore */ }
      this.clients.delete(name);
    }
    this.transports.clear();
  }
}

/** Entdeckte MCP-Tools als virtuelle Patterns in der Registry registrieren */
export function registerMcpTools(tools: McpToolInfo[], registry: PatternRegistry, serverName: string, exclude?: string[]): void {
  const excludeSet = exclude ? new Set(exclude) : undefined;
  for (const tool of tools) {
    if (excludeSet?.has(tool.name)) continue;
    registry.registerVirtual({
      meta: {
        name: tool.patternName,
        description: tool.description,
        category: tool.category,
        input_type: "json",
        output_type: "text",
        tags: ["mcp", tool.serverName],
        type: "mcp",
        mcp_server: tool.serverName,
        mcp_tool: tool.name,
        mcp_input_schema: tool.inputSchema,
      },
      systemPrompt: "",
      filePath: "",
    });
  }
}
