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
import { readRegistry, registerContext, writeRegistry } from "./registry.js";
import { getAiosHome } from "../utils/config.js";

export interface ScanResult {
  discovered: string[];
  updated: string[];
  stale: string[];
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

  // Register new / update existing
  for (const contextPath of foundPaths) {
    try {
      const manifest = readManifest(contextPath);
      registerContext(manifest, contextPath);

      if (knownPaths.has(resolve(contextPath))) {
        result.updated.push(contextPath);
      } else {
        result.discovered.push(contextPath);
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
    result.stale.push(stale.path);
  }

  // Remove stale entries from registry
  if (staleEntries.length > 0) {
    updatedRegistry.contexts = updatedRegistry.contexts.filter(
      (c) => !result.stale.includes(c.path)
    );
    writeRegistry(updatedRegistry);
  }

  // Validate links
  const finalRegistry = readRegistry();
  for (const entry of finalRegistry.contexts) {
    if (!entry.links?.length) continue;
    try {
      const manifest = readManifest(entry.path);
      for (const link of manifest.links) {
        if (!hasContext(link.path)) {
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
