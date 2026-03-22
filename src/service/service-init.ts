/**
 * Service Init – Bootstraps data/manifest.yaml for an existing context.
 *
 * Scans the context directory for existing data files (JSON/YAML arrays),
 * and uses the context.yaml exports/capabilities to infer what data
 * the context should provide. Generates manifest + template data if needed.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, extname } from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readManifest, assertPathWithinBase } from "../context/manifest.js";
import { inferSchema } from "./schema-inferrer.js";
import type { ContextConfig, DataSource } from "../types.js";

export interface InitResult {
  manifestCreated: boolean;
  dataFilesCreated: string[];
  sourcesDetected: DataSource[];
  message: string;
}

/**
 * Initialize service interfaces for an existing context.
 *
 * 1. Scans for existing data files in data/
 * 2. If found: auto-generates manifest from discovered files
 * 3. If not found: generates template data based on context.yaml
 */
export function initServiceInterface(contextPath: string): InitResult {
  const absPath = resolve(contextPath);
  const dataDir = resolve(absPath, "data");
  const manifestPath = resolve(dataDir, "manifest.yaml");

  // Check that this is a valid context
  if (!existsSync(resolve(absPath, ".aios", "context.yaml"))) {
    throw new Error(`Kein AIOS-Kontext gefunden in ${absPath} (.aios/context.yaml fehlt)`);
  }

  // If manifest already exists, skip
  if (existsSync(manifestPath)) {
    return {
      manifestCreated: false,
      dataFilesCreated: [],
      sourcesDetected: [],
      message: "data/manifest.yaml existiert bereits. Nutze 'aios service refresh' zum Aktualisieren.",
    };
  }

  const manifest = readManifest(absPath);

  // Ensure data directory exists
  mkdirSync(dataDir, { recursive: true });

  // Phase 1: Scan for existing data files
  const existingFiles = scanDataFiles(dataDir, absPath);

  if (existingFiles.length > 0) {
    // Auto-generate manifest from existing files
    const sources = existingFiles.map((f) => inferDataSource(f, dataDir));
    writeManifest(manifestPath, sources);

    return {
      manifestCreated: true,
      dataFilesCreated: [],
      sourcesDetected: sources,
      message: `data/manifest.yaml generiert aus ${sources.length} bestehenden Datendateien.`,
    };
  }

  // Phase 2: No existing data → generate templates from context.yaml
  const { sources, createdFiles } = generateTemplateData(manifest, dataDir);
  writeManifest(manifestPath, sources);

  return {
    manifestCreated: true,
    dataFilesCreated: createdFiles,
    sourcesDetected: sources,
    message: `data/manifest.yaml + ${createdFiles.length} Template-Dateien generiert.`,
  };
}

/**
 * Scan a directory for structured data files (JSON/YAML arrays).
 */
function scanDataFiles(dataDir: string, basePath: string): string[] {
  if (!existsSync(dataDir)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(dataDir)) {
    if (entry === "manifest.yaml") continue;
    const ext = extname(entry).toLowerCase();
    if (![".json", ".yaml", ".yml"].includes(ext)) continue;

    const filePath = resolve(dataDir, entry);
    assertPathWithinBase(filePath, basePath);

    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = ext === ".json" ? JSON.parse(raw) : parseYaml(raw);
      if (Array.isArray(data) && data.length > 0) {
        files.push(entry);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return files;
}

/**
 * Infer a DataSource from an existing data file.
 */
function inferDataSource(filename: string, dataDir: string): DataSource {
  const filePath = resolve(dataDir, filename);
  const { fields } = inferSchema(filePath);
  const name = filename.replace(/\.(json|yaml|yml)$/, "").replace(/[-\s]/g, "_");

  return {
    file: filename,
    name,
    description: `Daten aus ${filename}`,
    key_fields: fields.slice(0, 4).map((f) => f.name),
  };
}

/**
 * Generate template data files based on context.yaml capabilities/exports.
 */
function generateTemplateData(
  config: ContextConfig,
  dataDir: string,
): { sources: DataSource[]; createdFiles: string[] } {
  const sources: DataSource[] = [];
  const createdFiles: string[] = [];

  // Generate data from exports
  for (const exp of config.exports ?? []) {
    const fileName = `${exp.type.replace(/[-\s]/g, "_")}.json`;
    const filePath = resolve(dataDir, fileName);

    if (existsSync(filePath)) continue;

    const templateData = generateTemplateForExport(exp.type, exp.description, config);
    writeFileSync(filePath, JSON.stringify(templateData, null, 2), "utf-8");
    createdFiles.push(fileName);

    const { fields } = inferSchema(filePath);
    sources.push({
      file: fileName,
      name: exp.type.replace(/[-\s]/g, "_"),
      description: exp.description,
      key_fields: fields.slice(0, 4).map((f) => f.name),
    });
  }

  // If no exports, generate a generic data file based on context name/type
  if (sources.length === 0) {
    const fileName = `${config.name.replace(/[-\s]/g, "_")}_data.json`;
    const filePath = resolve(dataDir, fileName);

    const templateData = [
      { id: "1", name: "Beispiel-Eintrag", description: `${config.description}`, status: "aktiv" },
    ];
    writeFileSync(filePath, JSON.stringify(templateData, null, 2), "utf-8");
    createdFiles.push(fileName);

    sources.push({
      file: fileName,
      name: `${config.name.replace(/-/g, "_")}_data`,
      description: `${config.description} – Stammdaten`,
      key_fields: ["id", "name"],
    });
  }

  return { sources, createdFiles };
}

/**
 * Generate template data based on export type and context.
 */
function generateTemplateForExport(
  exportType: string,
  description: string,
  config: ContextConfig,
): Record<string, unknown>[] {
  // Match common export types to meaningful templates
  const type = exportType.toLowerCase();

  if (type.includes("security") || type.includes("finding")) {
    return [
      {
        id: "SEC-001",
        title: "Beispiel-Sicherheitsbefund",
        severity: "medium",
        component: "web-app",
        description: "Template – bitte mit echten Daten ersetzen",
        status: "open",
        found_date: new Date().toISOString().split("T")[0],
      },
    ];
  }

  if (type.includes("network") || type.includes("topology")) {
    return [
      {
        id: "NET-001",
        name: "Hauptnetzwerk",
        type: "vlan",
        subnet: "10.0.0.0/24",
        gateway: "10.0.0.1",
        description: "Template – bitte mit echten Daten ersetzen",
        status: "active",
      },
    ];
  }

  if (type.includes("employee") || type.includes("mitarbeiter") || type.includes("personal")) {
    return [
      {
        name: "Max Mustermann",
        personnel_number: "P-0001",
        department: config.name,
        role: "Mitarbeiter",
        email: "max@beispiel.de",
      },
    ];
  }

  // Generic fallback
  return [
    {
      id: "1",
      name: `Beispiel ${exportType}`,
      description: description || `${exportType} Datensatz`,
      status: "aktiv",
      created: new Date().toISOString().split("T")[0],
    },
  ];
}

function writeManifest(manifestPath: string, sources: DataSource[]): void {
  const manifest = {
    version: "1.0",
    sources: sources.map((s) => ({
      file: s.file,
      name: s.name,
      description: s.description,
      key_fields: s.key_fields,
    })),
  };

  writeFileSync(manifestPath, stringifyYaml(manifest, { lineWidth: 120 }), "utf-8");
}
