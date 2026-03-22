/**
 * Context Manifest Management
 *
 * Liest, schreibt und validiert .aios/context.yaml Dateien.
 * Unterstützt Schema-Migration und Merge (für --upgrade).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { stringify, parse } from "yaml";
import type { ContextManifest } from "../types.js";

export const CURRENT_SCHEMA_VERSION = "1.0";
export const CONTEXT_DIR = ".aios";
export const MANIFEST_FILE = "context.yaml";

/** Prüft ob ein Verzeichnis bereits einen AIOS-Kontext hat */
export function hasContext(dir: string): boolean {
  return existsSync(join(dir, CONTEXT_DIR, MANIFEST_FILE));
}

/** Prüft ob ein Verzeichnis das alte Format (aios.yaml im Root) hat */
export function hasLegacyConfig(dir: string): boolean {
  return existsSync(join(dir, "aios.yaml")) && !hasContext(dir);
}

/** Liest das Context Manifest aus einem Verzeichnis */
export function readManifest(dir: string): ContextManifest {
  const path = join(dir, CONTEXT_DIR, MANIFEST_FILE);
  if (!existsSync(path)) {
    throw new Error(`Kein AIOS-Kontext in ${dir}. Führe 'aios init' aus.`);
  }
  const raw = readFileSync(path, "utf-8");
  const manifest = parse(raw) as ContextManifest;
  validateManifest(manifest);
  return manifest;
}

/** Schreibt das Context Manifest */
export function writeManifest(dir: string, manifest: ContextManifest): void {
  const contextDir = join(dir, CONTEXT_DIR);
  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true });
  }
  const path = join(contextDir, MANIFEST_FILE);
  writeFileSync(path, stringify(manifest, { lineWidth: 120 }), "utf-8");
}

/** Validiert ein Manifest gegen das Schema */
export function validateManifest(manifest: ContextManifest): void {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("context.yaml: Kein gültiges Manifest (kein Objekt)");
  }
  if (!manifest.name) throw new Error("context.yaml: 'name' ist erforderlich");
  if (!manifest.description) throw new Error("context.yaml: 'description' ist erforderlich");
  if (!["project", "team", "library"].includes(manifest.type)) {
    throw new Error(`context.yaml: 'type' muss project|team|library sein, ist: ${manifest.type}`);
  }
  // Ensure array fields are present (graceful defaults for partial manifests)
  if (!Array.isArray(manifest.capabilities)) manifest.capabilities = [];
  if (!Array.isArray(manifest.exports)) manifest.exports = [];
  if (!Array.isArray(manifest.accepts)) manifest.accepts = [];
  if (!Array.isArray(manifest.links)) manifest.links = [];
  if (!manifest.config || typeof manifest.config !== "object") {
    manifest.config = {
      default_provider: "claude",
      patterns_dir: "./patterns",
      personas_dir: "./personas",
      knowledge_dir: "./knowledge",
    };
  }
}

/**
 * Prüft ob ein aufgelöster Pfad innerhalb einer Basis liegt.
 * Verhindert Path-Traversal-Angriffe über patterns_dir/personas_dir.
 */
export function assertPathWithinBase(resolvedPath: string, basePath: string): void {
  const normalizedBase = resolve(basePath);
  const normalizedTarget = resolve(resolvedPath);
  if (!normalizedTarget.startsWith(normalizedBase)) {
    throw new Error(`Path Traversal blockiert: "${resolvedPath}" liegt außerhalb von "${basePath}"`);
  }
}

/**
 * Merged ein bestehendes Manifest mit dem aktuellen Schema.
 * Bestehende Werte bleiben erhalten, fehlende werden mit Defaults ergänzt.
 */
export function mergeWithDefaults(
  existing: Partial<ContextManifest>,
  defaults: ContextManifest
): ContextManifest {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    name: existing.name ?? defaults.name,
    description: existing.description ?? defaults.description,
    type: existing.type ?? defaults.type,
    capabilities: existing.capabilities ?? defaults.capabilities,
    exports: existing.exports ?? defaults.exports,
    accepts: existing.accepts ?? defaults.accepts,
    config: {
      ...defaults.config,
      ...existing.config,
    },
    links: existing.links ?? defaults.links,
  };
}

/** Erzeugt ein leeres Default-Manifest */
export function createDefaultManifest(name: string, type: ContextManifest["type"]): ContextManifest {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    name,
    description: "",
    type,
    capabilities: [],
    exports: [],
    accepts: [],
    config: {
      default_provider: "claude",
      patterns_dir: "./patterns",
      personas_dir: "./personas",
      knowledge_dir: "./knowledge",
    },
    links: [],
  };
}
