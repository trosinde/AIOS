import { resolve } from "path";
import { loadDataFile } from "./schema-inferrer.js";
import { PromptBuilder } from "../security/prompt-builder.js";
import { assertPathWithinBase } from "../context/manifest.js";
import type { LLMProvider } from "../agents/provider.js";
import type { ExecutionContext, ServiceEndpoint, ServiceCallResult } from "../types.js";

/**
 * Hybrid query engine: direct search first, LLM fallback if needed.
 */
export async function queryService(
  endpoint: ServiceEndpoint,
  query: Record<string, unknown>,
  contextPath: string,
  provider?: LLMProvider,
  ctx?: ExecutionContext,
): Promise<ServiceCallResult> {
  const start = Date.now();
  const filePath = resolve(contextPath, "data", endpoint.data_file);
  assertPathWithinBase(filePath, contextPath);
  const records = loadDataFile(filePath);

  // Phase 1: Direct search on key_fields
  const directResults = directSearch(records, query, endpoint.key_fields);

  if (directResults.length > 0) {
    return {
      endpoint: endpoint.name,
      context: endpoint.context,
      query,
      results: directResults,
      method: "direct",
      durationMs: Date.now() - start,
    };
  }

  // Phase 2: LLM fallback for complex queries
  if (provider && ctx) {
    const llmResults = await llmSearch(records, query, endpoint, provider, ctx);
    return {
      endpoint: endpoint.name,
      context: endpoint.context,
      query,
      results: llmResults,
      method: "llm",
      durationMs: Date.now() - start,
    };
  }

  // No results and no LLM available
  return {
    endpoint: endpoint.name,
    context: endpoint.context,
    query,
    results: [],
    method: "direct",
    durationMs: Date.now() - start,
  };
}

function directSearch(
  records: Record<string, unknown>[],
  query: Record<string, unknown>,
  keyFields: string[],
): Record<string, unknown>[] {
  const queryEntries = Object.entries(query).filter(
    ([key]) => keyFields.includes(key),
  );

  if (queryEntries.length === 0) return [];

  return records.filter((record) =>
    queryEntries.every(([key, value]) => {
      const recordValue = record[key];
      if (recordValue === undefined) return false;

      // Exact match
      if (recordValue === value) return true;

      // Case-insensitive substring match for strings
      if (typeof recordValue === "string" && typeof value === "string") {
        return recordValue.toLowerCase().includes(value.toLowerCase());
      }

      return false;
    }),
  );
}

async function llmSearch(
  records: Record<string, unknown>[],
  query: Record<string, unknown>,
  endpoint: ServiceEndpoint,
  provider: LLMProvider,
  ctx: ExecutionContext,
): Promise<Record<string, unknown>[]> {
  // Limit data sent to LLM to avoid token overflow
  const dataSlice = records.slice(0, 200);
  const dataStr = JSON.stringify(dataSlice, null, 2);
  const queryStr = JSON.stringify(query);

  // Use PromptBuilder for Data/Instruction Separation
  const promptBuilder = new PromptBuilder();
  const patternPrompt = `Du bist ein Daten-Query-Service.
Du erhältst strukturierte Daten und eine Suchanfrage.
Finde die passenden Datensätze und gib sie als JSON-Array zurück.
Antworte NUR mit dem JSON-Array, kein anderer Text.
Wenn keine Treffer: antworte mit []`;

  const userInput = `Daten (${endpoint.data_file}, ${records.length} Datensätze):\n${dataStr}\n\nSuchanfrage: ${queryStr}`;

  const built = promptBuilder.build(patternPrompt, userInput, [], ctx.trace_id);

  const response = await provider.complete(built.systemPrompt, built.userMessage, undefined, ctx);

  try {
    // Extract JSON array from response
    const text = response.content.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]) as unknown;

    // Validate LLM output: must be an array of objects
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item),
    );
  } catch {
    return [];
  }
}
