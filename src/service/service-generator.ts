import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseDataManifest } from "./manifest-parser.js";
import { inferSchema } from "./schema-inferrer.js";
import type { ServiceEndpoint } from "../types.js";

const CACHE_FILE = "services.generated.yaml";

/**
 * Generate service endpoints for a context by reading its data manifest
 * and inferring schemas from data files. Results are cached.
 */
export function generateServiceEndpoints(
  contextPath: string,
  contextName: string,
): ServiceEndpoint[] {
  const manifest = parseDataManifest(contextPath);
  if (!manifest) return [];

  // Check cache
  const cached = readCache(contextPath);
  if (cached && isCacheValid(cached, contextPath, manifest)) {
    return cached;
  }

  // Generate fresh endpoints
  const endpoints: ServiceEndpoint[] = [];

  for (const source of manifest.sources) {
    const filePath = resolve(contextPath, "data", source.file);

    try {
      const { fields, recordCount } = inferSchema(filePath);

      endpoints.push({
        name: source.name,
        description: source.description,
        context: contextName,
        data_file: source.file,
        fields,
        key_fields: source.key_fields ?? fields.map((f) => f.name),
        record_count: recordCount,
        last_indexed: Date.now(),
      });
    } catch (err) {
      console.error(
        `⚠️  Service "${source.name}": Schema-Inferenz fehlgeschlagen für ${source.file}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // Write cache
  writeCache(contextPath, endpoints);

  return endpoints;
}

function readCache(contextPath: string): ServiceEndpoint[] | null {
  const cachePath = resolve(contextPath, ".aios", CACHE_FILE);
  if (!existsSync(cachePath)) return null;

  try {
    const raw = readFileSync(cachePath, "utf-8");
    const parsed = parseYaml(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as ServiceEndpoint[];
  } catch {
    return null;
  }
}

function isCacheValid(
  cached: ServiceEndpoint[],
  contextPath: string,
  manifest: { sources: Array<{ file: string }> },
): boolean {
  if (cached.length === 0) return false;

  const cacheTime = Math.min(...cached.map((e) => e.last_indexed));

  // Check if any data file is newer than cache
  for (const source of manifest.sources) {
    const filePath = resolve(contextPath, "data", source.file);
    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs > cacheTime) return false;
    } catch {
      return false;
    }
  }

  // Check manifest itself
  const manifestPath = resolve(contextPath, "data", "manifest.yaml");
  try {
    const stat = statSync(manifestPath);
    if (stat.mtimeMs > cacheTime) return false;
  } catch {
    return false;
  }

  return true;
}

function writeCache(contextPath: string, endpoints: ServiceEndpoint[]): void {
  const cachePath = resolve(contextPath, ".aios", CACHE_FILE);
  try {
    writeFileSync(cachePath, stringifyYaml(endpoints), "utf-8");
  } catch {
    // Cache write failure is non-fatal
  }
}
