// ─── Pattern ─────────────────────────────────────────────

export interface PatternMeta {
  name: string;
  description: string;
  category: string;
  input_type: string;
  output_type: string;
  tags: string[];
  needs_context?: string[];
  can_follow?: string[];
  can_precede?: string[];
  parallelizable_with?: string[];
  persona?: string;
  preferred_provider?: string;
  internal?: boolean;
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
  durationMs: number;
}

export interface WorkflowResult {
  plan: ExecutionPlan;
  results: Map<string, StepResult>;
  status: Map<string, StepStatus>;
  totalDurationMs: number;
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

export interface AiosConfig {
  providers: Record<string, ProviderConfig>;
  defaults: { provider: string };
  paths: { patterns: string; personas: string };
}
