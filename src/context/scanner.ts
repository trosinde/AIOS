/**
 * Context Scanner
 *
 * Scannt das Dateisystem nach .aios/context.yaml Dateien,
 * registriert gefundene Kontexte in der globalen Registry
 * und validiert bestehende Links.
 */

import { existsSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { readManifest, hasContext } from "./manifest.js";
import { readRegistry, registerContext, writeRegistry, type RegistryEntry } from "./registry.js";

export interface ContextInfo {
  path: string;
  entry: RegistryEntry;
}

export interface ScanResult {
  discovered: ContextInfo[];
  updated: ContextInfo[];
  stale: RegistryEntry[];
  brokenLinks: { context: string; linkName: string; path: string }[];
}

/**
 * Scannt gegebene Verzeichnisse (und deren Kinder) nach .aios/context.yaml.
 * Registriert neu gefundene Kontexte und aktualisiert bestehende.
 * Entfernt Kontexte aus der Registry deren Pfad nicht mehr existiert.
 * Validiert dass Link-Ziele noch existieren.
 */
export function scanContexts(searchPaths: string[], maxDepth = 3): ScanResult {
  const result: ScanResult = {
    discovered: [],
    updated: [],
    stale: [],
    brokenLinks: [],
  };

  const registry = readRegistry();
  const knownPaths = new Set(registry.contexts.map((c) => c.path));
  const foundPaths = new Set<string>();

  // Scan search paths for .aios/context.yaml
  for (const searchPath of searchPaths) {
    const absPath = resolve(searchPath);
    if (!existsSync(absPath)) continue;
    findContexts(absPath, 0, maxDepth, foundPaths);
  }

  // Register new / update existing — deduplicate by name (first path wins)
  const registeredNames = new Set<string>();
  for (const contextPath of foundPaths) {
    try {
      const manifest = readManifest(contextPath);

      if (registeredNames.has(manifest.name)) continue;
      registeredNames.add(manifest.name);

      registerContext(manifest, contextPath);

      // Re-read the entry to get the full RegistryEntry
      const reg = readRegistry();
      const entry = reg.contexts.find((c) => c.path === resolve(contextPath));
      if (!entry) continue;

      const info: ContextInfo = { path: contextPath, entry };
      if (knownPaths.has(resolve(contextPath))) {
        result.updated.push(info);
      } else {
        result.discovered.push(info);
      }
    } catch (err) {
      console.error(`  Warnung: Manifest in ${contextPath} nicht lesbar: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Find stale entries (registered but path no longer exists)
  const updatedRegistry = readRegistry();
  const staleEntries = updatedRegistry.contexts.filter(
    (c) => !existsSync(join(c.path, ".aios", "context.yaml"))
  );
  for (const stale of staleEntries) {
    result.stale.push(stale);
  }

  // Remove stale entries from registry
  if (staleEntries.length > 0) {
    updatedRegistry.contexts = updatedRegistry.contexts.filter(
      (c) => !staleEntries.some((s) => s.path === c.path)
    );
    writeRegistry(updatedRegistry);
  }

  // Validate links — resolve by name in registry, fall back to path check
  const finalRegistry = readRegistry();
  const registryNames = new Set(finalRegistry.contexts.map((c) => c.name));
  for (const entry of finalRegistry.contexts) {
    if (!entry.links?.length) continue;
    try {
      const manifest = readManifest(entry.path);
      for (const link of manifest.links) {
        const resolvedByName = registryNames.has(link.name);
        const resolvedByPath = hasContext(resolve(entry.path, link.path));
        if (!resolvedByName && !resolvedByPath) {
          result.brokenLinks.push({
            context: entry.name,
            linkName: link.name,
            path: link.path,
          });
        }
      }
    } catch {
      // Manifest nicht lesbar – überspringen
    }
  }

  return result;
}

/** Rekursiv nach Verzeichnissen mit .aios/context.yaml suchen */
function findContexts(dir: string, depth: number, maxDepth: number, found: Set<string>): void {
  if (depth > maxDepth) return;

  if (hasContext(dir)) {
    found.add(resolve(dir));
    // Don't recurse into context directories
    return;
  }

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // Skip hidden dirs, node_modules, .git
      if (entry.startsWith(".") || entry === "node_modules") continue;

      const fullPath = join(dir, entry);
      try {
        const stat = lstatSync(fullPath);
        // Skip symlinks to prevent traversal attacks
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          findContexts(fullPath, depth + 1, maxDepth, found);
        }
      } catch {
        // Permission denied or broken symlink – skip
      }
    }
  } catch {
    // Can't read directory – skip
  }
}
