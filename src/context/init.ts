/**
 * aios federation init – Initialisiert oder erweitert einen AIOS-Kontext
 *
 * Drei Modi:
 * 1. Neu: Kein .aios/ vorhanden → alles anlegen
 * 2. Upgrade: .aios/context.yaml existiert → fehlende Felder ergänzen
 * 3. Migration: aios.yaml existiert aber kein .aios/ → migrieren
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { parse } from "yaml";
import chalk from "chalk";
import {
  hasContext,
  hasLegacyConfig,
  readManifest,
  writeManifest,
  createDefaultManifest,
  mergeWithDefaults,
} from "./manifest.js";
import { registerContext } from "./registry.js";
import type { ContextConfig } from "../types.js";

export interface InitOptions {
  name?: string;
  description?: string;
  type?: ContextConfig["type"];
  template?: "project" | "team" | "library";
  upgrade?: boolean;
  nonInteractive?: boolean;
}

const SUBDIRS = ["knowledge", "patterns", "personas", "links"];

export async function initContext(dir: string, opts: InitOptions): Promise<void> {
  const absDir = resolve(dir);

  // ─── Fall 1: Upgrade bestehender Kontext ──────────────
  if (hasContext(absDir)) {
    console.error(chalk.blue("📦 Bestehender AIOS-Kontext erkannt. Upgrade..."));
    await upgradeContext(absDir);
    return;
  }

  // ─── Fall 2: Migration von altem Format ───────────────
  if (hasLegacyConfig(absDir)) {
    console.error(chalk.yellow("📋 Altes Format (aios.yaml) erkannt. Migriere..."));
    await migrateFromLegacy(absDir, opts);
    return;
  }

  // ─── Fall 3: Neuer Kontext ────────────────────────────
  console.error(chalk.green("🆕 Neuen AIOS-Kontext erstellen..."));
  await createNewContext(absDir, opts);
}

async function createNewContext(dir: string, opts: InitOptions): Promise<void> {
  const name = opts.name ?? basename(dir);
  const type = opts.template ?? opts.type ?? "project";

  const manifest = createDefaultManifest(name, type);
  manifest.description = opts.description ?? `AIOS-Kontext: ${name}`;

  applyTemplate(manifest, type);

  const contextDir = join(dir, ".aios");
  mkdirSync(contextDir, { recursive: true });
  for (const sub of SUBDIRS) {
    const subDir = join(contextDir, sub);
    if (!existsSync(subDir)) {
      mkdirSync(subDir, { recursive: true });
    }
  }

  writeManifest(dir, manifest);
  registerContext(manifest, dir);

  console.error(chalk.green(`✅ Kontext "${name}" initialisiert in ${dir}`));
  console.error(chalk.gray(`   Manifest: .aios/context.yaml`));
  console.error(chalk.gray(`   Typ: ${type}`));
  if (manifest.capabilities.length > 0) {
    console.error(chalk.cyan(`   Fähigkeiten: ${manifest.capabilities.map((c) => c.id).join(", ")}`));
  }
  console.error(chalk.gray(`\n   Nächste Schritte:`));
  console.error(chalk.gray(`   1. Editiere .aios/context.yaml – beschreibe Fähigkeiten und Exports`));
  console.error(chalk.gray(`   2. Lege Patterns in .aios/patterns/ ab`));
  console.error(chalk.gray(`   3. Verknüpfe mit: aios context link <anderer-kontext>`));
}

async function upgradeContext(dir: string): Promise<void> {
  const existing = readManifest(dir);
  const defaults = createDefaultManifest(existing.name, existing.type);
  const merged = mergeWithDefaults(existing, defaults);

  const contextDir = join(dir, ".aios");
  for (const sub of SUBDIRS) {
    const subDir = join(contextDir, sub);
    if (!existsSync(subDir)) {
      mkdirSync(subDir, { recursive: true });
      console.error(chalk.gray(`   + ${sub}/`));
    }
  }

  writeManifest(dir, merged);
  registerContext(merged, dir);

  console.error(chalk.green(`✅ Kontext "${merged.name}" aktualisiert auf Schema v${merged.schema_version}`));
}

async function migrateFromLegacy(dir: string, opts: InitOptions): Promise<void> {
  const legacyPath = join(dir, "aios.yaml");
  const legacy = parse(readFileSync(legacyPath, "utf-8")) as Record<string, Record<string, string>>;

  const name = opts.name ?? legacy.project?.name ?? basename(dir);
  const manifest = createDefaultManifest(name, opts.type ?? "project");
  manifest.description = opts.description ?? `Migriert aus ${basename(dir)}`;

  if (legacy.defaults?.provider) {
    manifest.config.default_provider = legacy.defaults.provider;
  }
  if (legacy.paths?.patterns) {
    manifest.config.patterns_dir = legacy.paths.patterns;
  }
  if (legacy.paths?.personas) {
    manifest.config.personas_dir = legacy.paths.personas;
  }

  const contextDir = join(dir, ".aios");
  mkdirSync(contextDir, { recursive: true });
  for (const sub of SUBDIRS) {
    const subDir = join(contextDir, sub);
    if (!existsSync(subDir)) {
      mkdirSync(subDir, { recursive: true });
    }
  }

  writeManifest(dir, manifest);
  registerContext(manifest, dir);

  console.error(chalk.green(`✅ Migriert: aios.yaml → .aios/context.yaml`));
  console.error(chalk.gray(`   aios.yaml wurde nicht verändert (Rückwärtskompatibilität)`));
}

/** Wendet Template-spezifische Defaults an */
function applyTemplate(manifest: ContextConfig, template: string): void {
  switch (template) {
    case "team":
      manifest.config.team = {
        personas: [],
        default_persona: undefined,
      };
      break;
    case "library":
      manifest.exports.push({
        type: "patterns",
        scope: "shared",
        description: "Wiederverwendbare Pattern-Bibliothek",
      });
      break;
    case "project":
    default:
      manifest.capabilities.push({
        id: "code_generation",
        description: "Code erzeugen und testen",
        input_types: ["requirements", "design"],
        output_type: "code",
      });
      break;
  }
}
