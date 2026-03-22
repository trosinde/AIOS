/**
 * Globale Context Registry
 *
 * Verwaltet ~/.aios/registry.yaml – das Verzeichnis aller bekannten Kontexte.
 * Der Cross-Context Router liest nur diese Datei.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { stringify, parse } from "yaml";
import { getAiosHome } from "../utils/config.js";
import type { ContextManifest } from "../types.js";

const REGISTRY_FILE = "registry.yaml";

export interface RegistryLink {
  name: string;
  relationship: string;
}

export interface RegistryEntry {
  name: string;
  path: string;
  type: ContextManifest["type"];
  description: string;
  capabilities: string[];
  links?: RegistryLink[];
  last_updated: string;
}

export interface Registry {
  contexts: RegistryEntry[];
}

/** Liest die globale Registry */
export function readRegistry(): Registry {
  const path = join(getAiosHome(), REGISTRY_FILE);
  if (!existsSync(path)) return { contexts: [] };
  const raw = parse(readFileSync(path, "utf-8")) as Registry | null;
  return raw?.contexts ? raw : { contexts: [] };
}

/** Schreibt die globale Registry */
export function writeRegistry(registry: Registry): void {
  const home = getAiosHome();
  if (!existsSync(home)) mkdirSync(home, { recursive: true });
  const path = join(home, REGISTRY_FILE);
  writeFileSync(path, stringify(registry, { lineWidth: 120 }), "utf-8");
}

/** Registriert oder aktualisiert einen Kontext in der Registry */
export function registerContext(manifest: ContextManifest, contextPath: string): void {
  const registry = readRegistry();
  const absPath = resolve(contextPath);
  const idx = registry.contexts.findIndex((c) => c.path === absPath);

  const entry: RegistryEntry = {
    name: manifest.name,
    path: absPath,
    type: manifest.type,
    description: manifest.description,
    capabilities: manifest.capabilities.map((c) => c.id),
    links: (manifest.links ?? []).map((l) => ({ name: l.name, relationship: l.relationship })),
    last_updated: new Date().toISOString(),
  };

  if (idx >= 0) {
    registry.contexts[idx] = entry;
  } else {
    registry.contexts.push(entry);
  }

  writeRegistry(registry);
}

/** Entfernt einen Kontext aus der Registry */
export function unregisterContext(contextPath: string): void {
  const registry = readRegistry();
  const absPath = resolve(contextPath);
  registry.contexts = registry.contexts.filter((c) => c.path !== absPath);
  writeRegistry(registry);
}

/** Baut den Katalog-Text für den Cross-Context Router */
export function buildContextCatalog(): string {
  const registry = readRegistry();
  if (registry.contexts.length === 0) return "Keine Kontexte registriert.";

  return registry.contexts
    .map((c) => [
      `## ${c.name} (${c.type})`,
      `Pfad: ${c.path}`,
      `Beschreibung: ${c.description}`,
      `Fähigkeiten: ${c.capabilities.join(", ")}`,
      `Verknüpfungen: ${c.links?.length ? c.links.map((l) => `${l.name} (${l.relationship})`).join(", ") : "keine"}`,
    ].join("\n"))
    .join("\n\n");
}
