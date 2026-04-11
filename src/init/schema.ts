import { z } from "zod";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { ContextConfig, ComplianceStandard } from "../types.js";

// Re-export for convenience
export type { ComplianceStandard } from "../types.js";

// ─── Legacy AiosContext Zod Schema (for --refresh backward compat) ───

const ComplianceStandardSchema = z.object({
  id: z.string(),
  level: z.string().optional(),
});

const LegacyAiosContextSchema = z.object({
  version: z.literal("1"),
  project: z.object({
    name: z.string().min(1),
    description: z.string(),
    domain: z.string(),
    language: z.string(),
    repo: z.string().nullable(),
  }),
  aios: z.object({
    path: z.string().min(1),
    readOnly: z.boolean(),
  }),
  compliance: z.object({
    standards: z.array(ComplianceStandardSchema),
    requireTraceability: z.boolean(),
    requireTestCoverage: z.boolean(),
    minimumCoverage: z.number().min(0).max(100).optional(),
  }),
  personas: z.object({
    active: z.array(z.string()),
    inactive: z.array(z.string()),
  }),
  providers: z.object({
    routing: z.record(z.string(), z.string()),
  }),
  knowledge: z.object({
    autoIndex: z.array(z.string()),
    autoExtract: z.boolean(),
  }),
});

/** @deprecated Internal wizard type — use ContextConfig for all new code */
export type AiosContext = z.infer<typeof LegacyAiosContextSchema>;

// ─── Unified ContextConfig Helpers ────────────────────────

/**
 * Parse a context.yaml string into a ContextConfig.
 * Supports both the new unified format and the legacy AiosContext format.
 * Throws with clear error messages on invalid input.
 */
export function parseContextYaml(raw: string): ContextConfig {
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid context.yaml: empty or not an object");
  }

  const obj = parsed as Record<string, unknown>;

  // Detect legacy AiosContext format (has version: "1" + project.name, no schema_version)
  if (obj.version === "1" && !obj.schema_version && obj.project) {
    const result = LegacyAiosContextSchema.safeParse(parsed);
    if (result.success) {
      return legacyToContextConfig(result.data);
    }
  }

  // Unified format: must have name and schema_version (or at least name)
  if (!obj.name) {
    throw new Error("Invalid context.yaml:\n  - name: Required");
  }

  return normalizeContextConfig(obj);
}

/**
 * Serialize a ContextConfig to clean YAML.
 * Validates required fields before serializing.
 */
export function serializeContext(ctx: ContextConfig): string {
  if (!ctx.name || typeof ctx.name !== "string") {
    throw new Error("serializeContext: 'name' is required");
  }
  if (ctx.type && !["project", "team", "library"].includes(ctx.type)) {
    throw new Error(`serializeContext: invalid type '${ctx.type}'`);
  }
  return yamlStringify(ctx, { lineWidth: 120 });
}

/**
 * Create a default ContextConfig with sensible wizard defaults.
 */
export function createDefaultContext(overrides: Partial<WizardInput> = {}): ContextConfig {
  const name = overrides.project?.name ?? "unnamed-project";
  const description = overrides.project?.description ?? "";

  return {
    schema_version: "1.0",
    name,
    description,
    type: "project",
    capabilities: [],
    exports: [],
    accepts: [],
    links: [],
    config: {
      default_provider: "claude",
      patterns_dir: "./patterns",
      personas_dir: "./personas",
      knowledge_dir: "./knowledge",
    },
    project: {
      domain: overrides.project?.domain ?? "general",
      language: overrides.project?.language ?? "unknown",
      repo: overrides.project?.repo ?? null,
    },
    aios: {
      path: overrides.aios?.path ?? "",
      readOnly: overrides.aios?.readOnly ?? true,
    },
    compliance: {
      standards: overrides.compliance?.standards ?? [],
      requireTraceability: overrides.compliance?.requireTraceability ?? false,
      requireTestCoverage: overrides.compliance?.requireTestCoverage ?? false,
      minimumCoverage: overrides.compliance?.minimumCoverage,
    },
    personas: {
      active: overrides.personas?.active ?? ["developer"],
      inactive: overrides.personas?.inactive ?? [],
    },
    providers: {
      routing: overrides.providers?.routing ?? {},
    },
    knowledge: {
      autoIndex: overrides.knowledge?.autoIndex ?? [],
      autoExtract: overrides.knowledge?.autoExtract ?? false,
    },
  };
}

// ─── Internal Helpers ─────────────────────────────────────

/** Input shape for the wizard (matches old AiosContext fields) */
export interface WizardInput {
  project?: {
    name?: string;
    description?: string;
    domain?: string;
    language?: string;
    repo?: string | null;
  };
  aios?: {
    path?: string;
    readOnly?: boolean;
  };
  compliance?: {
    standards?: ComplianceStandard[];
    requireTraceability?: boolean;
    requireTestCoverage?: boolean;
    minimumCoverage?: number;
  };
  personas?: {
    active?: string[];
    inactive?: string[];
  };
  providers?: {
    routing?: Record<string, string>;
  };
  knowledge?: {
    autoIndex?: string[];
    autoExtract?: boolean;
  };
}

/** Convert legacy AiosContext to unified ContextConfig */
function legacyToContextConfig(legacy: AiosContext): ContextConfig {
  return {
    schema_version: "1.0",
    name: legacy.project.name,
    description: legacy.project.description,
    type: "project",
    capabilities: [],
    exports: [],
    accepts: [],
    links: [],
    config: {
      default_provider: Object.values(legacy.providers.routing)[0] ?? "claude",
      patterns_dir: "./patterns",
      personas_dir: "./personas",
      knowledge_dir: "./knowledge",
    },
    project: {
      domain: legacy.project.domain,
      language: legacy.project.language,
      repo: legacy.project.repo,
    },
    aios: {
      path: legacy.aios.path,
      readOnly: legacy.aios.readOnly,
    },
    compliance: {
      standards: legacy.compliance.standards,
      requireTraceability: legacy.compliance.requireTraceability,
      requireTestCoverage: legacy.compliance.requireTestCoverage,
      minimumCoverage: legacy.compliance.minimumCoverage,
    },
    personas: {
      active: legacy.personas.active,
      inactive: legacy.personas.inactive,
    },
    providers: {
      routing: legacy.providers.routing,
    },
    knowledge: {
      autoIndex: legacy.knowledge.autoIndex,
      autoExtract: legacy.knowledge.autoExtract,
    },
  };
}

/** Normalize a parsed YAML object into a ContextConfig with defaults.
 *  Validates structural types at runtime to catch malformed YAML early. */
function normalizeContextConfig(obj: Record<string, unknown>): ContextConfig {
  // Runtime type guards for structural integrity
  const name = obj.name;
  if (typeof name !== "string" || !name) {
    throw new Error("Invalid context.yaml:\n  - name: Required and must be a string");
  }

  const type = obj.type;
  if (type !== undefined && !["project", "team", "library"].includes(type as string)) {
    throw new Error(`Invalid context.yaml:\n  - type: Must be project|team|library, got: ${type}`);
  }

  const safeArray = (val: unknown): unknown[] =>
    Array.isArray(val) ? val : [];

  const safeObj = (val: unknown, fallback: Record<string, unknown>): Record<string, unknown> =>
    val && typeof val === "object" && !Array.isArray(val) ? val as Record<string, unknown> : fallback;

  const configDefault = {
    default_provider: "claude",
    patterns_dir: "./patterns",
    personas_dir: "./personas",
    knowledge_dir: "./knowledge",
  };

  return {
    schema_version: typeof obj.schema_version === "string" ? obj.schema_version : "1.0",
    name,
    description: typeof obj.description === "string" ? obj.description : "",
    type: (type as ContextConfig["type"]) ?? "project",
    capabilities: safeArray(obj.capabilities) as ContextConfig["capabilities"],
    exports: safeArray(obj.exports) as ContextConfig["exports"],
    accepts: safeArray(obj.accepts) as ContextConfig["accepts"],
    links: safeArray(obj.links) as ContextConfig["links"],
    config: safeObj(obj.config, configDefault) as ContextConfig["config"],
    ...(obj.project && typeof obj.project === "object" ? { project: obj.project as ContextConfig["project"] } : {}),
    ...(obj.aios && typeof obj.aios === "object" ? { aios: obj.aios as ContextConfig["aios"] } : {}),
    ...(obj.compliance && typeof obj.compliance === "object" ? { compliance: obj.compliance as ContextConfig["compliance"] } : {}),
    ...(obj.personas && typeof obj.personas === "object" ? { personas: obj.personas as ContextConfig["personas"] } : {}),
    ...(obj.providers && typeof obj.providers === "object" ? { providers: obj.providers as ContextConfig["providers"] } : {}),
    ...(obj.knowledge && typeof obj.knowledge === "object" ? { knowledge: obj.knowledge as ContextConfig["knowledge"] } : {}),
    ...(obj.permissions && typeof obj.permissions === "object" ? { permissions: obj.permissions as ContextConfig["permissions"] } : {}),
    ...(Array.isArray(obj.required_traits) ? { required_traits: obj.required_traits as string[] } : {}),
    ...(obj.memory && typeof obj.memory === "object" && !Array.isArray(obj.memory)
      ? { memory: obj.memory as ContextConfig["memory"] }
      : {}),
  };
}
