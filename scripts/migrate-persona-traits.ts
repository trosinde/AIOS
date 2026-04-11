#!/usr/bin/env tsx
/**
 * One-shot migration: Ergänzt alle personas/*.yaml um Base Trait Protocol
 * Instruktionen im system_prompt (handoff, trace, optional confidence).
 *
 * Idempotent: Prüft ob bereits migriert (Marker-String).
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const PERSONAS_DIR = join(process.cwd(), "personas");
const MARKER = "## Base Trait Protocol";

const TRAIT_BLOCK = `
  ## Base Trait Protocol (Pflicht)

  Schließe JEDE Antwort mit diesem Block ab, damit der nächste Agent anknüpfen kann:

  \`\`\`
  ## Handoff
  **Next agent needs:** <was der nächste Agent wissen muss>

  <!-- trace: <trace_id> -->
  \`\`\`

  Bei niedriger Konfidenz (z. B. unvollständige Eingaben, widersprüchliche Quellen)
  füge VOR dem Handoff-Block hinzu:
  \`⚠️ LOW_CONFIDENCE: <kurze Erklärung warum unsicher>\`

  Die trace_id wird vom Kernel bereitgestellt und ist rückverfolgbar über alle Agenten.
`;

interface MigrationResult {
  file: string;
  action: "migrated" | "skipped" | "error";
  reason?: string;
}

function migrate(file: string): MigrationResult {
  const path = join(PERSONAS_DIR, file);
  const content = readFileSync(path, "utf-8");

  if (content.includes(MARKER)) {
    return { file, action: "skipped", reason: "already migrated" };
  }

  const lines = content.split("\n");
  const startIdx = lines.findIndex(l => /^system_prompt:\s*\|/.test(l));
  if (startIdx === -1) {
    return { file, action: "skipped", reason: "no system_prompt block" };
  }

  // Find end of block: first line after startIdx that is not indented (>=2 spaces)
  // or that starts a new top-level key
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    // Top-level key = starts with non-space character
    if (/^\S/.test(line)) {
      endIdx = i;
      break;
    }
  }

  // Strip trailing blank lines inside the block
  let insertIdx = endIdx;
  while (insertIdx > startIdx + 1 && lines[insertIdx - 1].trim() === "") {
    insertIdx--;
  }

  const traitLines = TRAIT_BLOCK.split("\n");
  const newLines = [
    ...lines.slice(0, insertIdx),
    ...traitLines,
    ...lines.slice(insertIdx),
  ];

  writeFileSync(path, newLines.join("\n"));
  return { file, action: "migrated" };
}

const files = readdirSync(PERSONAS_DIR).filter(f => f.endsWith(".yaml"));
const results = files.map(migrate);

for (const r of results) {
  const icon = r.action === "migrated" ? "✓" : r.action === "skipped" ? "~" : "✗";
  console.log(`${icon} ${r.file}${r.reason ? " (" + r.reason + ")" : ""}`);
}

const migrated = results.filter(r => r.action === "migrated").length;
console.log(`\n${migrated}/${files.length} personas migrated.`);
