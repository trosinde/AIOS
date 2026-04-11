// ─── Execution Context (kernel-stable) ───────────────────

export interface ExecutionContext {
  trace_id: string;      // UUID v4, vom Kernel vergeben
  context_id: string;    // Aktiver User-Space-Kontext
  started_at: number;    // Unix timestamp ms
}

// ─── Selection Strategy ─────────────────────────────────

export type SelectionStrategy = "cheapest" | "best";

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
  selection_strategy?: SelectionStrategy;
  internal?: boolean;
  kernel_abi?: number;

  // Tool-Pattern Felder
  type?: "llm" | "tool" | "mcp" | "rag" | "image_generation" | "tts";  // Default: "llm"
  tool?: string;                   // CLI-Befehl (z.B. "mmdc")
  tool_args?: string[];            // Args-Template: ["$INPUT", "-o", "$OUTPUT"]
  input_format?: string;           // Erwartetes Input-Format (z.B. "mermaid")
  output_format?: string[];        // Mögliche Output-Formate (z.B. ["svg", "png"])

  // TTS-Pattern Felder
  tts_voice?: string;              // Stimme (z.B. "alloy", "nova")
  tts_model?: string;              // Modell (z.B. "tts-1", "tts-1-hd")
  tts_format?: string;             // Audio-Format (z.B. "mp3", "wav")
  tts_speed?: number;              // Geschwindigkeit (0.25 - 4.0)

  // MCP-Pattern Felder
  mcp_server?: string;             // Server-Name aus Config
  mcp_tool?: string;               // Original MCP-Tool-Name
  mcp_input_schema?: object;       // JSON Schema für Tool-Args

  // RAG-Pattern Felder
  rag_collection?: string;
  rag_operation?: "search" | "index" | "compare";
  rag_overrides?: { topK?: number; minRelevance?: number };

  // Capability-Based Provider Selection: required capabilities per pattern
  requires?: TaskRequirements;
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
  filePaths?: string[];            // Multiple output files (e.g. thumbnails)
  durationMs: number;

  // ─── Capability-Based Provider Selection Provenance ───
  provider?: string;               // Provider name (e.g. "ollama-qwen-235b")
  model?: string;                  // Model identifier (e.g. "qwen3:235b")
  attempt?: number;                // 1 = first try, 2+ = retry/escalation
  escalationPath?: string[];       // Provider names in order of tries
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

// ─── Knowledge Bus (kernel-stable) ──────────────────────

export interface KernelMessage {
  id: string;
  trace_id: string;
  source_context: string;
  target_context: string;     // "*" = broadcast
  created_at: number;         // Unix timestamp ms
  type: KnowledgeType;
  tags: string[];
  source_pattern: string;
  source_step?: string;
  content: string;
  format: "text" | "json" | "markdown";
  metadata?: Record<string, unknown>;
}

export interface KnowledgeQuery {
  type?: KnowledgeType;
  tags?: string[];
  source_pattern?: string;
  since?: number;             // Unix timestamp
  limit?: number;             // Default: 50
  include_cross_context?: boolean;
}

// ─── Provider ────────────────────────────────────────────

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: { input: number; output: number };
  images?: Array<{ mimeType: string; data: string }>;
}

export interface ProviderConfig {
  type: "anthropic" | "ollama" | "gemini" | "openai" | "opencode";
  model: string;
  endpoint?: string;
  apiKey?: string;       // Bearer token for authenticated Ollama endpoints
  capabilities?: string[];     // Legacy tag-based capabilities e.g. ["vision", "code"]
  cost_per_mtok?: number;      // $/million input tokens (0 = free/local)
  quality?: Record<string, number>;  // capability → quality score 0-10

  // ─── Capability-Based Provider Selection ──────────────
  model_capabilities?: ModelCapabilities;  // Score-based capability profile
  cost?: CostInfo;                         // Tier + per-Mtok pricing
}

// ─── Model Capabilities (Score-based) ────────────────────

export interface ModelCapabilities {
  reasoning: number;              // 1-10: logical reasoning / analysis
  code_generation: number;        // 1-10: code synthesis / refactoring
  instruction_following: number;  // 1-10: follows prompt instructions precisely
  structured_output: number;      // 1-10: reliable JSON/Markdown output
  language: string[];             // Supported languages e.g. ["de", "en"]
  max_context: number;            // Max context window in tokens
}

export interface TaskRequirements {
  reasoning?: number;
  code_generation?: number;
  instruction_following?: number;
  structured_output?: number;
  language?: string;              // Single required language
  min_context?: number;           // Minimum required context window
}

export interface CostInfo {
  tier: number;                   // 1 = cheap/local, 5 = expensive
  input_per_mtok: number;         // USD per million input tokens
  output_per_mtok: number;        // USD per million output tokens
}

// ─── Escalation Policy ───────────────────────────────────

export type EscalationStrategy = "upgrade_on_fail" | "same_model_retry" | "fail_fast";

export interface EscalationConfig {
  maxRetries: number;             // 0-3 retries allowed per step
  strategy: EscalationStrategy;
  retrySameTierFirst: boolean;    // Retry same provider before upgrading
  cooldownMs: number;             // Pause between retries
}

// ─── Selector Results ────────────────────────────────────

export interface RankedProvider {
  name: string;
  config: ProviderConfig;
  capable: boolean;
  costTier: number;
  headroom: number;               // Average excess over requirements
  history?: PatternStats;
}

// ─── Execution Memory Records ────────────────────────────

export type ExecutionOutcome = "success" | "retry" | "failed";

export interface ExecutionRecord {
  timestamp: string;              // ISO 8601
  pattern: string;
  provider: string;
  model: string;
  costTier: number;
  outcome: ExecutionOutcome;
  errorType?: string;             // "invalid_json" | "timeout" | "rate_limit" | ...
  attempt: number;                // 1 = first try
  escalatedFrom?: string;         // Previous provider name
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
  stepId?: string;
  workflowId?: string;
}

export interface PatternStats {
  pattern?: string;               // Pattern name (populated by allStats)
  provider: string;
  costTier: number;
  totalRuns: number;
  successRate: number;            // 0-100
  avgDurationMs: number;
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
  proxy?: boolean;         // Tools via MCP-Server nach außen exponieren (default: true)
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

// ─── Context (Unified Schema) ────────────────────────────
//
// EIN Format, EIN Schema für .aios/context.yaml.
// Ersetzt die drei vorherigen inkompatiblen Formate:
//   - ContextManifest (Federation)
//   - ContextConfig (Lightweight/Runtime)
//   - AiosContext (Init-Wizard)

export interface ContextCapability {
  id: string;
  description: string;
  input_types: string[];
  output_type: string;
}

export interface ContextExport {
  type: string;
  scope: string;
  description: string;
}

export interface ContextAccept {
  type: string;
  description: string;
}

export interface ContextLink {
  name: string;
  path: string;
  relationship: "audits" | "consults" | "feeds" | "depends_on";
}

// ─── Data Manifest (User Space) ──────────────────────

export interface DataSource {
  file: string;                    // Relativer Pfad zur Datendatei
  name: string;                    // Service-Name (snake_case)
  description: string;
  key_fields?: string[];           // Felder für direkte Suche
}

export interface DataManifest {
  version: "1.0";
  sources: DataSource[];
}

// ─── Auto-generierte Service Interfaces (User Space) ──

export interface InferredField {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  sample?: string;
}

export interface ServiceEndpoint {
  name: string;
  description: string;
  context: string;
  data_file: string;
  fields: InferredField[];
  key_fields: string[];
  record_count: number;
  last_indexed: number;
}

export interface ServiceCallResult {
  endpoint: string;
  context: string;
  query: Record<string, unknown>;
  results: Record<string, unknown>[];
  method: "direct" | "llm";
  durationMs: number;
}

export interface ServiceRequest {
  id: string;
  trace_id: string;
  source_context: string;
  target_context: string;
  endpoint: string;
  input: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at: number;
  completed_at?: number;
  response?: string;
  error?: string;
}

export interface ComplianceStandard {
  id: string;
  level?: string;
}

/**
 * Unified context.yaml schema.
 * Jede .aios/context.yaml MUSS dieses Format verwenden.
 */
export interface ContextConfig {
  schema_version: string;
  name: string;
  description: string;
  type: "project" | "team" | "library";

  // ─── Federation ────────────────────────────────────
  capabilities: ContextCapability[];
  exports: ContextExport[];
  accepts: ContextAccept[];
  links: ContextLink[];

  // ─── Directory & Provider Config ───────────────────
  config: {
    default_provider: string;
    patterns_dir: string;
    personas_dir: string;
    knowledge_dir: string;
    pattern_sources?: string[];
    standards?: string[];
    team?: {
      personas: string[];
      default_persona?: string;
    };
  };

  // ─── Project Details (optional, from init wizard) ──
  project?: {
    domain?: string;
    language?: string;
    repo?: string | null;
  };

  // ─── AIOS Installation Reference (optional) ───────
  aios?: {
    path?: string;
    readOnly?: boolean;
  };

  // ─── Compliance (optional) ─────────────────────────
  compliance?: {
    standards: ComplianceStandard[];
    requireTraceability?: boolean;
    requireTestCoverage?: boolean;
    minimumCoverage?: number;
  };

  // ─── Personas (optional) ───────────────────────────
  personas?: {
    active: string[];
    inactive?: string[];
  };

  // ─── Provider Routing (optional) ───────────────────
  providers?: {
    routing?: Record<string, string>;
  };

  // ─── Knowledge (optional) ──────────────────────────
  knowledge?: {
    autoIndex?: string[];
    autoExtract?: boolean;
    backend?: "sqlite";
    isolation?: "strict" | "relaxed";
    retention_days?: number;
  };

  // ─── Runtime Permissions (optional) ────────────────
  permissions?: {
    allow_ipc?: boolean;
    allow_tool_execution?: boolean;
    allowed_tools?: string[];
  };

  // ─── Required Traits (optional) ────────────────────
  required_traits?: string[];
}

/** @deprecated Use ContextConfig instead */
export type ContextManifest = ContextConfig;

// ─── Cross-Context Execution ─────────────────────────────

export interface CrossContextStep {
  id: string;
  context: string;
  task: string;
  depends_on: string[];
  input_from: string[];
  output_type: string;
}

export interface CrossContextPlan {
  analysis: {
    goal: string;
    contexts_needed: string[];
    single_context: boolean;
  };
  plan: {
    type: "pipe" | "scatter_gather" | "dag";
    steps: CrossContextStep[];
  };
  reasoning: string;
}

export interface CrossContextStepResult {
  stepId: string;
  context: string;
  output: string;
  localPlan?: ExecutionPlan;
  durationMs: number;
}

export interface CrossContextResult {
  plan: CrossContextPlan;
  results: Map<string, CrossContextStepResult>;
  status: Map<string, StepStatus>;
  totalDurationMs: number;
}

// ─── Config ─────────────────────────────────────────────

export interface AiosConfig {
  providers: Record<string, ProviderConfig>;
  defaults: {
    provider: string;
    router_provider?: string;    // Provider forced for router (always strongest)
  };
  paths: { patterns: string; personas: string };
  tools: ToolsConfig;
  mcp?: McpConfig;
  rag?: import("./rag/types.js").RagConfig;
  escalation?: EscalationConfig;
}
