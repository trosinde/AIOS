import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import type { InferredField } from "../types.js";

export interface InferResult {
  fields: InferredField[];
  recordCount: number;
}

/**
 * Infer schema from a structured data file (JSON or YAML).
 * Expects file content to be an array of objects.
 */
export function inferSchema(filePath: string): InferResult {
  const raw = readFileSync(filePath, "utf-8");
  const data = filePath.endsWith(".yaml") || filePath.endsWith(".yml")
    ? parseYaml(raw)
    : JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error(`${filePath}: Datei muss ein Array von Objekten enthalten`);
  }

  if (data.length === 0) {
    return { fields: [], recordCount: 0 };
  }

  const fields = inferFieldsFromRecords(data);

  return { fields, recordCount: data.length };
}

function inferFieldsFromRecords(records: unknown[]): InferredField[] {
  const fieldMap = new Map<string, InferredField>();

  // Scan first few records to get a comprehensive field list
  const sampleSize = Math.min(records.length, 5);
  for (let i = 0; i < sampleSize; i++) {
    const record = records[i];
    if (!record || typeof record !== "object") continue;

    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      if (fieldMap.has(key)) continue;

      fieldMap.set(key, {
        name: key,
        type: inferType(value),
        sample: sampleValue(value),
      });
    }
  }

  return Array.from(fieldMap.values());
}

function inferType(value: unknown): InferredField["type"] {
  if (value === null || value === undefined) return "string";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return "string";
}

function sampleValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.length > 50 ? value.slice(0, 50) + "…" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return "{…}";
  return undefined;
}

/**
 * Load structured data from a file as an array of records.
 */
export function loadDataFile(filePath: string): Record<string, unknown>[] {
  const raw = readFileSync(filePath, "utf-8");
  const data = filePath.endsWith(".yaml") || filePath.endsWith(".yml")
    ? parseYaml(raw)
    : JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error(`${filePath}: Datei muss ein Array von Objekten enthalten`);
  }

  return data as Record<string, unknown>[];
}
