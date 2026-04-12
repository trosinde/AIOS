import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import chalk from "chalk";
import ora from "ora";
import type { ExecutionContext, KnowledgeType } from "../types.js";
import { resolveWing, loadWingConfig } from "../core/wing-resolver.js";

interface LegacyBusRow {
  id: string;
  trace_id: string;
  source_context: string;
  target_context: string;
  created_at: number;
  type: string;
  tags: string;
  source_pattern: string;
  source_step: string | null;
  content: string;
  format: string;
  metadata: string | null;
}

interface LegacyKnowledgeRow {
  id: string;
  type: string;
  content: string;
  source: string;
  tags: string;
  project: string | null;
  created_at: string;
}

interface MigrateOptions {
  context?: string;
  dryRun?: boolean;
  quiet?: boolean;
}

export interface MigrateResult {
  found: boolean;
  migrated: number;
  skipped: number;
  failed: number;
}

const CATEGORY_FROM_TYPE: Record<string, string> = {
  decision: "decisions",
  fact: "facts",
  finding: "findings",
  pattern: "patterns",
  lesson: "lessons",
  requirement: "facts",
  artifact: "facts",
};

function findLegacyDb(aiosHome: string): string | null {
  const candidates = [
    join(aiosHome, "knowledge", "bus.db.pre-lance.bak"),
    join(aiosHome, "knowledge", "bus.db"),
    join(aiosHome, "knowledge.pre-lance.bak"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

function findLegacyKnowledgeDb(aiosHome: string): string | null {
  const candidates = [
    join(aiosHome, "knowledge.db"),
    join(aiosHome, "knowledge", "knowledge.db"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

function readLegacyBusRows(dbPath: string): LegacyBusRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    if (!tables.some((t) => t.name === "messages")) return [];
    return db.prepare("SELECT * FROM messages ORDER BY created_at ASC").all() as LegacyBusRow[];
  } finally {
    db.close();
  }
}

function readLegacyKnowledgeRows(dbPath: string): LegacyKnowledgeRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    if (!tables.some((t) => t.name === "knowledge")) return [];
    return db
      .prepare("SELECT * FROM knowledge ORDER BY created_at ASC")
      .all() as LegacyKnowledgeRow[];
  } finally {
    db.close();
  }
}

export async function runKnowledgeMigrate(options: MigrateOptions): Promise<MigrateResult> {
  const noResult: MigrateResult = { found: false, migrated: 0, skipped: 0, failed: 0 };
  const aiosHome = join(process.env.HOME ?? homedir(), ".aios");
  const wingCfg = loadWingConfig();

  const legacyBusPath = findLegacyDb(aiosHome);
  const legacyKbPath = findLegacyKnowledgeDb(aiosHome);

  if (!legacyBusPath && !legacyKbPath) {
    if (!options.quiet) {
      console.error(chalk.yellow("Keine Legacy-Datenbank gefunden."));
      console.error(
        chalk.gray(
          "Gesucht in:\n" +
            "  ~/.aios/knowledge/bus.db.pre-lance.bak\n" +
            "  ~/.aios/knowledge/bus.db\n" +
            "  ~/.aios/knowledge.pre-lance.bak\n" +
            "  ~/.aios/knowledge.db",
        ),
      );
    }
    return noResult;
  }

  const quiet = options.quiet ?? false;
  let busRows: LegacyBusRow[] = [];
  let kbRows: LegacyKnowledgeRow[] = [];

  if (legacyBusPath) {
    if (quiet) {
      try { busRows = readLegacyBusRows(legacyBusPath); } catch { /* ignore */ }
    } else {
      const spinner = ora({
        text: `Lese Legacy-KnowledgeBus: ${legacyBusPath}`,
        stream: process.stderr,
      }).start();
      try {
        busRows = readLegacyBusRows(legacyBusPath);
        spinner.succeed(`${busRows.length} Messages in ${legacyBusPath}`);
      } catch (e) {
        spinner.fail(`Fehler beim Lesen: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (legacyKbPath) {
    if (quiet) {
      try { kbRows = readLegacyKnowledgeRows(legacyKbPath); } catch { /* ignore */ }
    } else {
      const spinner = ora({
        text: `Lese Legacy-KnowledgeBase: ${legacyKbPath}`,
        stream: process.stderr,
      }).start();
      try {
        kbRows = readLegacyKnowledgeRows(legacyKbPath);
        spinner.succeed(`${kbRows.length} Items in ${legacyKbPath}`);
      } catch (e) {
        spinner.fail(`Fehler beim Lesen: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const totalRows = busRows.length + kbRows.length;
  if (totalRows === 0) {
    if (!quiet) console.error(chalk.yellow("Legacy-Datenbanken sind leer — nichts zu migrieren."));
    return { found: true, migrated: 0, skipped: 0, failed: 0 };
  }

  if (options.dryRun) {
    console.error(chalk.cyan(`Dry-Run: ${totalRows} Einträge würden migriert.`));
    if (busRows.length > 0) {
      console.error(chalk.gray(`  KnowledgeBus (messages): ${busRows.length}`));
      const types = new Map<string, number>();
      for (const r of busRows) types.set(r.type, (types.get(r.type) ?? 0) + 1);
      for (const [t, c] of types) console.error(chalk.gray(`    ${t}: ${c}`));
    }
    if (kbRows.length > 0) {
      console.error(chalk.gray(`  KnowledgeBase (knowledge): ${kbRows.length}`));
      const types = new Map<string, number>();
      for (const r of kbRows) types.set(r.type, (types.get(r.type) ?? 0) + 1);
      for (const [t, c] of types) console.error(chalk.gray(`    ${t}: ${c}`));
    }
    return { found: true, migrated: 0, skipped: 0, failed: 0 };
  }

  const { KnowledgeBus } = await import("../core/knowledge-bus.js");
  const { randomUUID } = await import("crypto");

  const knowledgeDir = join(aiosHome, "knowledge");
  const bus = await KnowledgeBus.create(knowledgeDir);
  const contextId = options.context ?? "default";
  const ctx: ExecutionContext = {
    trace_id: randomUUID(),
    context_id: contextId,
    started_at: Date.now(),
  };

  let migrated = 0;
  let skippedDup = 0;
  let failed = 0;

  try {

  // Migrate KnowledgeBus rows
  if (busRows.length > 0) {
    const spinner = quiet ? null : ora({
      text: `Migriere KnowledgeBus-Messages (0/${busRows.length})...`,
      stream: process.stderr,
    }).start();

    for (let i = 0; i < busRows.length; i++) {
      const row = busRows[i];
      try {
        const dup = await bus.checkDuplicate(row.content, ctx);
        if (dup) {
          skippedDup++;
          continue;
        }

        const category = CATEGORY_FROM_TYPE[row.type] ?? "facts";
        const wing = resolveWing(category, wingCfg);

        let tags: string[] = [];
        try {
          const parsed = JSON.parse(row.tags);
          if (Array.isArray(parsed)) tags = parsed.map(String);
        } catch {
          /* leave empty */
        }

        let metadata: Record<string, unknown> | undefined;
        if (row.metadata) {
          try {
            metadata = JSON.parse(row.metadata);
          } catch {
            /* ignore */
          }
        }

        const publishCtx: ExecutionContext = {
          trace_id: row.trace_id,
          context_id: row.source_context || contextId,
          started_at: row.created_at,
        };

        await bus.publish(
          {
            type: row.type as KnowledgeType,
            tags,
            source_pattern: row.source_pattern,
            source_step: row.source_step ?? undefined,
            content: row.content,
            format: (row.format as "text" | "json" | "markdown") ?? "text",
            target_context: row.target_context,
            metadata,
            wing,
          },
          publishCtx,
        );
        migrated++;
      } catch (e) {
        failed++;
        if (!quiet && failed <= 3) {
          spinner?.clear();
          console.error(
            chalk.red(`  Fehler bei Row ${row.id}: ${e instanceof Error ? e.message : String(e)}`),
          );
        }
      }

      if (spinner && ((i + 1) % 10 === 0 || i === busRows.length - 1)) {
        spinner.text = `Migriere KnowledgeBus-Messages (${i + 1}/${busRows.length})...`;
      }
    }
    spinner?.succeed(`KnowledgeBus: ${migrated} migriert, ${skippedDup} Duplikate übersprungen`);
  }

  // Migrate KnowledgeBase rows
  if (kbRows.length > 0) {
    const kbMigrated0 = migrated;
    const kbSkipped0 = skippedDup;
    const spinner = quiet ? null : ora({
      text: `Migriere KnowledgeBase-Items (0/${kbRows.length})...`,
      stream: process.stderr,
    }).start();

    for (let i = 0; i < kbRows.length; i++) {
      const row = kbRows[i];
      try {
        const dup = await bus.checkDuplicate(row.content, ctx);
        if (dup) {
          skippedDup++;
          continue;
        }

        const category = CATEGORY_FROM_TYPE[row.type] ?? "facts";
        const wing = resolveWing(category, wingCfg);

        let tags: string[] = [];
        try {
          const parsed = JSON.parse(row.tags);
          if (Array.isArray(parsed)) tags = parsed.map(String);
        } catch {
          /* leave empty */
        }

        const createdAt = row.created_at
          ? new Date(row.created_at).getTime()
          : Date.now();

        const publishCtx: ExecutionContext = {
          trace_id: randomUUID(),
          context_id: row.project ?? contextId,
          started_at: createdAt,
        };

        await bus.publish(
          {
            type: row.type as KnowledgeType,
            tags,
            source_pattern: row.source || "legacy-import",
            content: row.content,
            format: "text",
            target_context: row.project ?? contextId,
            wing,
          },
          publishCtx,
        );
        migrated++;
      } catch (e) {
        failed++;
        if (!quiet && failed <= 3) {
          spinner?.clear();
          console.error(
            chalk.red(`  Fehler bei Item ${row.id}: ${e instanceof Error ? e.message : String(e)}`),
          );
        }
      }

      if (spinner && ((i + 1) % 10 === 0 || i === kbRows.length - 1)) {
        spinner.text = `Migriere KnowledgeBase-Items (${i + 1}/${kbRows.length})...`;
      }
    }
    spinner?.succeed(
      `KnowledgeBase: ${migrated - kbMigrated0} migriert, ${skippedDup - kbSkipped0} Duplikate übersprungen`,
    );
  }

  // Build vector index if enough data
  if (migrated >= 256) {
    if (!quiet) {
      const indexSpinner = ora({
        text: "Baue HNSW-Vektor-Index...",
        stream: process.stderr,
      }).start();
      await bus.ensureVectorIndex();
      indexSpinner.succeed("HNSW-Index aktualisiert");
    } else {
      await bus.ensureVectorIndex();
    }
  }

  } finally {
    await bus.close();
  }

  // Summary
  if (!quiet) {
    console.error();
    console.error(chalk.green.bold("  Migration abgeschlossen"));
    console.error(chalk.gray(`  Migriert:  ${migrated}`));
    console.error(chalk.gray(`  Duplikate: ${skippedDup} (übersprungen)`));
    if (failed > 0) {
      console.error(chalk.yellow(`  Fehler:    ${failed}`));
    }
    console.error();
    if (migrated > 0) {
      console.error(chalk.gray('  Teste mit: aios knowledge search "<suchbegriff>"'));
    }
  }

  return { found: true, migrated, skipped: skippedDup, failed };
}
