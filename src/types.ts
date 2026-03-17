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
  type?: "llm" | "tool";          // Default: "llm"
  tool?: string;                   // CLI-Befehl (z.B. "mmdc")
  tool_args?: string[];            // Args-Template: ["$INPUT", "-o", "$OUTPUT"]
  input_format?: string;           // Erwartetes Input-Format (z.B. "mermaid")
  output_format?: string[];        // Mögliche Output-Formate (z.B. ["svg", "png"])
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
  retry?: { max: number; on_failure?: "retry_with_feedback" | "escalate"; escalate_to?: string } | null;
  quality_gate?: { pattern: string; min_score: number } | null;
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
}

// ─── Config ──────────────────────────────────────────────

export interface ToolsConfig {
  output_dir: string;              // Wohin Tool-Outputs geschrieben werden
  allowed: string[];               // Allowlist erlaubter CLI-Tools
}

export interface AiosConfig {
  providers: Record<string, ProviderConfig>;
  defaults: { provider: string };
  paths: { patterns: string; personas: string };
  tools: ToolsConfig;
}
