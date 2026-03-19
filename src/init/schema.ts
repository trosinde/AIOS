import { z } from "zod";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";

// ─── Zod Schema ──────────────────────────────────────────

const ComplianceStandardSchema = z.object({
  id: z.string(),
  level: z.string().optional(),
});

const AiosContextSchema = z.object({
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

// ─── Exported Types ────────────────────────────────────────

export type AiosContext = z.infer<typeof AiosContextSchema>;
export type ComplianceStandard = z.infer<typeof ComplianceStandardSchema>;

// ─── Parse & Serialize ─────────────────────────────────────

/**
 * Parse a context.yaml string into a validated AiosContext.
 * Throws with clear error messages on invalid input.
 */
export function parseContextYaml(raw: string): AiosContext {
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid context.yaml: empty or not an object");
  }
  const result = AiosContextSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid context.yaml:\n${issues}`);
  }
  return result.data;
}

/**
 * Serialize an AiosContext to clean YAML.
 */
export function serializeContext(ctx: AiosContext): string {
  // Validate before serializing
  AiosContextSchema.parse(ctx);
  return yamlStringify(ctx, { lineWidth: 120 });
}

/**
 * Create a default AiosContext with sensible defaults.
 */
export function createDefaultContext(overrides: Partial<AiosContext> = {}): AiosContext {
  const defaults: AiosContext = {
    version: "1",
    project: {
      name: "unnamed-project",
      description: "",
      domain: "general",
      language: "unknown",
      repo: null,
    },
    aios: {
      path: "",
      readOnly: true,
    },
    compliance: {
      standards: [],
      requireTraceability: false,
      requireTestCoverage: false,
    },
    personas: {
      active: ["developer"],
      inactive: [],
    },
    providers: {
      routing: {},
    },
    knowledge: {
      autoIndex: [],
      autoExtract: false,
    },
  };

  return {
    ...defaults,
    ...overrides,
    project: { ...defaults.project, ...(overrides.project ?? {}) },
    aios: { ...defaults.aios, ...(overrides.aios ?? {}) },
    compliance: { ...defaults.compliance, ...(overrides.compliance ?? {}) },
    personas: { ...defaults.personas, ...(overrides.personas ?? {}) },
    providers: { ...defaults.providers, ...(overrides.providers ?? {}) },
    knowledge: { ...defaults.knowledge, ...(overrides.knowledge ?? {}) },
  };
}
