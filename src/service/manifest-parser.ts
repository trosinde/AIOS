import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";
import { assertPathWithinBase } from "../context/manifest.js";
import type { DataManifest, DataSource } from "../types.js";

/**
 * Parse and validate a data/manifest.yaml from a context directory.
 * Returns null if no manifest exists.
 */
export function parseDataManifest(contextPath: string): DataManifest | null {
  const manifestPath = resolve(contextPath, "data", "manifest.yaml");
  if (!existsSync(manifestPath)) return null;

  assertPathWithinBase(manifestPath, contextPath);

  const raw = readFileSync(manifestPath, "utf-8");
  const parsed = parseYaml(raw) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`data/manifest.yaml in ${contextPath}: Ungültiges Format`);
  }

  if (parsed.version !== "1.0") {
    throw new Error(`data/manifest.yaml: version muss "1.0" sein, ist "${parsed.version}"`);
  }

  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
    throw new Error("data/manifest.yaml: 'sources' muss ein nicht-leeres Array sein");
  }

  const sources: DataSource[] = [];
  for (const src of parsed.sources) {
    validateDataSource(src, contextPath);
    sources.push({
      file: src.file,
      name: src.name,
      description: src.description,
      key_fields: Array.isArray(src.key_fields) ? src.key_fields : undefined,
    });
  }

  return { version: "1.0", sources };
}

function validateDataSource(src: unknown, contextPath: string): asserts src is DataSource {
  if (!src || typeof src !== "object") {
    throw new Error("data/manifest.yaml: Jede Source muss ein Objekt sein");
  }

  const s = src as Record<string, unknown>;

  if (!s.file || typeof s.file !== "string") {
    throw new Error("data/manifest.yaml: Source 'file' fehlt oder ist kein String");
  }
  if (!s.name || typeof s.name !== "string") {
    throw new Error(`data/manifest.yaml: Source '${s.file}' hat kein 'name' Feld`);
  }
  if (!s.description || typeof s.description !== "string") {
    throw new Error(`data/manifest.yaml: Source '${s.name}' hat kein 'description' Feld`);
  }

  // Validate referenced file exists and is within context
  const filePath = resolve(contextPath, "data", s.file);
  assertPathWithinBase(filePath, contextPath);

  if (!existsSync(filePath)) {
    throw new Error(`data/manifest.yaml: Datei '${s.file}' existiert nicht in ${contextPath}/data/`);
  }

  if (s.key_fields !== undefined && !Array.isArray(s.key_fields)) {
    throw new Error(`data/manifest.yaml: Source '${s.name}' key_fields muss ein Array sein`);
  }
}
