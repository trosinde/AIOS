// ─── Pattern ─────────────────────────────────────────────

export interface PatternParameter {
  name: string;
  type: "string" | "enum" | "number" | "boolean";
  description?: string;
  values?: string[];
  default?: string | number | boolean;
  required?: boolean;
}

export interface PatternMeta {
  name: string;
  version?: string;
  description: string;
  category: string;
  input_type: string;
  output_type: string;
  tags: string[];
  parameters?: PatternParameter[];
  needs_context?: string[];
  can_follow?: string[];
  can_precede?: string[];
  parallelizable_with?: string[];
  persona?: string;
  preferred_provider?: string;
  internal?: boolean;

  // Tool-Pattern Felder
  type?: "llm" | "tool" | "mcp";  // Default: "llm"
  tool?: string;                   // CLI-Befehl (z.B. "mmdc")
  tool_args?: string[];            // Args-Template: ["$INPUT", "-o", "$OUTPUT"]
  input_format?: string;           // Erwartetes Input-Format (z.B. "mermaid")
  output_format?: string[];        // Mögliche Output-Formate (z.B. ["svg", "png"])

  // MCP-Pattern Felder
  mcp_server?: string;             // Server-Name aus Config
  mcp_tool?: string;               // Original MCP-Tool-Name
  mcp_input_schema?: object;       // JSON Schema für Tool-Args
}

export interface Pattern {
  meta: PatternMeta;
  systemPrompt: string;
  filePath: string;
}

// ─── Execution Plan (Router Output) ─────────────────────

export interface ExecutionStep {
  id: string;
  pattern: string;
  persona?: string;
  depends_on: string[];
  input_from: string[];         // "$USER_INPUT" oder step-IDs
  parallel_group?: string | null;
  retry?: { max: number; on_failure?: "retry_with_feedback" | "escalate" | "rollback"; escalate_to?: string } | null;
  quality_gate?: { pattern: string; min_score: number } | null;
  compensate?: { pattern: string; input_from?: string[] } | null;  // Saga rollback
}

export interface ExecutionPlan {
  analysis: {
    goal: string;
    complexity: "low" | "medium" | "high";
    requires_compliance: boolean;
    disciplines: string[];
  };
  plan: {
    type: "pipe" | "scatter_gather" | "dag" | "saga";
    steps: ExecutionStep[];
  };
  reasoning: string;
}

// ─── Engine ──────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface StepResult {
  stepId: string;
  pattern: string;
  output: string;
  outputType: "text" | "file";    // Was output enthält
  filePath?: string;               // Bei outputType: "file"
  durationMs: number;
}

export interface WorkflowResult {
  plan: ExecutionPlan;
  results: Map<string, StepResult>;
  status: Map<string, StepStatus>;
  totalDurationMs: number;
}

// ─── Persona ──────────────────────────────────────────────

export interface Persona {
  id: string;
  name: string;
  role: string;
  description: string;
  system_prompt: string;
  expertise: string[];
  preferred_patterns: string[];
  preferred_provider?: string;
  communicates_with: string[];
  output_format?: string;
}

// ─── Knowledge Base ───────────────────────────────────────

export type KnowledgeType = "decision" | "fact" | "requirement" | "artifact";

export interface KnowledgeItem {
  id: string;
  type: KnowledgeType;
  content: string;
  source: string;           // Which pattern/step produced this
  tags: string[];
  created_at: string;       // ISO timestamp
  project?: string;
}

// ─── Provider ────────────────────────────────────────────

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: { input: number; output: number };
}

export interface ProviderConfig {
  type: "anthropic" | "ollama";
  model: string;
  endpoint?: string;
  apiKey?: string;       // Bearer token for authenticated Ollama endpoints
}

// ─── Chat / REPL ────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  source?: string;  // "chat" | "pattern:<name>"
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  provider: string;
}

export interface SlashCommand {
  name: string;
  args: string;
  params: Record<string, string>;
}

// ─── Config ──────────────────────────────────────────────

export interface ToolsConfig {
  output_dir: string;              // Wohin Tool-Outputs geschrieben werden
  allowed: string[];               // Allowlist erlaubter CLI-Tools
}

// ─── MCP ────────────────────────────────────────────────

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  category?: string;       // Pattern-Kategorie (default: "mcp")
  prefix?: string;         // Pattern-Name-Prefix (default: Server-Name)
  description?: string;    // Menschenlesbarer Name für Katalog
  exclude?: string[];      // Tool-Namen die nicht registriert werden
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

// ─── Config ─────────────────────────────────────────────

export interface AiosConfig {
  providers: Record<string, ProviderConfig>;
  defaults: { provider: string };
  paths: { patterns: string; personas: string };
  tools: ToolsConfig;
  mcp?: McpConfig;
}
