import { createInterface, type Interface } from "readline";
import chalk from "chalk";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { homedir } from "os";
import { parse as parseYaml } from "yaml";
import type { ScanResult } from "./scanner.js";
import type { AiosContext, ComplianceStandard } from "./schema.js";
import { createDefaultContext } from "./schema.js";

// ─── Options ─────────────────────────────────────────────

export interface WizardOptions {
  quick?: boolean;
  yes?: boolean;
  aiosPath?: string;
}

// ─── Prompt Helpers ──────────────────────────────────────

function createRL(): Interface {
  return createInterface({ input: process.stdin, output: process.stderr });
}

async function ask(rl: Interface, prompt: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` [${defaultVal}]` : "";
  return new Promise((resolve) => {
    rl.question(`  ${prompt}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

async function askYN(rl: Interface, prompt: string, defaultYes: boolean): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  return new Promise((resolve) => {
    rl.question(`  ${prompt} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes" || a === "j" || a === "ja");
    });
  });
}

async function askChoice(rl: Interface, prompt: string, options: string[], defaultIdx: number = 0): Promise<number> {
  console.error(`  ${prompt}`);
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? chalk.green("→") : " ";
    console.error(`    ${marker} ${i + 1}) ${options[i]}`);
  }
  const answer = await ask(rl, "Choice", String(defaultIdx + 1));
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < options.length) return idx;
  return defaultIdx;
}

async function askMultiChoice(rl: Interface, prompt: string, options: string[], defaults: number[] = []): Promise<number[]> {
  console.error(`  ${prompt} (comma-separated numbers, or Enter for defaults)`);
  for (let i = 0; i < options.length; i++) {
    const marker = defaults.includes(i) ? chalk.green("✓") : " ";
    console.error(`    ${marker} ${i + 1}) ${options[i]}`);
  }
  const defaultStr = defaults.map((d) => d + 1).join(",");
  const answer = await ask(rl, "Selection", defaultStr);
  const indices = answer
    .split(",")
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < options.length);
  return indices.length > 0 ? indices : defaults;
}

// ─── AIOS Path Detection ─────────────────────────────────

function detectAiosPath(cwd: string): string | null {
  const candidates = [
    resolve(cwd, "..", "AIOS"),
    resolve(cwd, "..", "aios"),
    join(homedir(), "tools", "AIOS"),
    join(homedir(), "AIOS"),
    join(homedir(), ".local", "share", "aios"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "patterns")) && existsSync(join(candidate, "src"))) {
      return candidate;
    }
  }
  return null;
}

// ─── Domain Suggestions ──────────────────────────────────

function suggestDomain(scan: ScanResult): string {
  const frameworks = scan.detectedFrameworks;
  if (frameworks.includes("nextjs") || frameworks.includes("react") || frameworks.includes("vue") || frameworks.includes("angular") || frameworks.includes("svelte")) {
    return "web-frontend";
  }
  if (frameworks.includes("nestjs") || frameworks.includes("express") || frameworks.includes("fastify") || frameworks.includes("hono")) {
    return "web-backend";
  }
  if (scan.language === "rust") return "systems";
  if (scan.language === "go") return "backend";
  if (scan.language === "python") return "data-science";
  return "general";
}

// ─── Dynamic Persona Discovery ──────────────────────────

/**
 * Discover all persona IDs from the personas directory.
 * Reads YAML files and subdirectory system.md files.
 * Returns sorted, deduplicated list of persona IDs.
 */
function discoverAllPersonas(aiosPath: string): string[] {
  const personasDir = join(aiosPath, "personas");
  if (!existsSync(personasDir)) return [];

  const ids = new Set<string>();

  for (const entry of readdirSync(personasDir, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
      try {
        const raw = readFileSync(join(personasDir, entry.name), "utf-8");
        const data = parseYaml(raw) as { id?: string };
        if (data?.id) ids.add(data.id);
      } catch { /* skip invalid */ }
    } else if (entry.isDirectory()) {
      const systemMd = join(personasDir, entry.name, "system.md");
      if (existsSync(systemMd)) {
        try {
          const raw = readFileSync(systemMd, "utf-8");
          // Extract id from YAML frontmatter
          const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
          if (match) {
            const frontmatter = parseYaml(match[1]) as { id?: string };
            if (frontmatter?.id) ids.add(frontmatter.id);
          }
        } catch { /* skip invalid */ }
      }
    }
  }

  return [...ids].sort();
}

const DOMAIN_OPTIONS = [
  "web-frontend", "web-backend", "fullstack", "systems",
  "embedded", "data-science", "devops", "industrial-iot",
  "mobile", "general",
];

// ─── Wizard ──────────────────────────────────────────────

/**
 * Run the interactive wizard.
 * Returns AiosContext on success, null on user cancel.
 */
export async function runWizard(
  scan: ScanResult,
  cwd: string,
  options: WizardOptions = {},
): Promise<AiosContext | null> {
  // Quick mode: no interaction, use scan defaults
  if (options.quick) {
    return buildQuickContext(scan, cwd, options.aiosPath);
  }

  const rl = createRL();

  try {
    // ─── Display scan results ─────────────────────────
    console.error();
    console.error(chalk.bold("═══════════════════════════════════════"));
    console.error(chalk.bold("  AIOS Project Init Wizard"));
    console.error(chalk.bold("═══════════════════════════════════════"));
    console.error();

    console.error(chalk.cyan("  Scan Results:"));
    console.error(chalk.gray(`    Language:    ${scan.language}`));
    console.error(chalk.gray(`    Module:      ${scan.moduleSystem}`));
    console.error(chalk.gray(`    Tests:       ${scan.hasTests ? `Yes (${scan.testFramework})` : "No"}`));
    console.error(chalk.gray(`    CI/CD:       ${scan.hasCi ? scan.ciTool : "None"}`));
    console.error(chalk.gray(`    Source files: ${scan.sourceFileCount}`));
    if (scan.detectedFrameworks.length > 0) {
      console.error(chalk.gray(`    Frameworks:  ${scan.detectedFrameworks.join(", ")}`));
    }
    if (scan.complianceHints.length > 0) {
      console.error(chalk.gray(`    Compliance:  ${scan.complianceHints.join(", ")}`));
    }
    if (scan.existingAios) {
      console.error(chalk.yellow("    ⚠ Existing .aios/ detected"));
    }
    console.error();

    // ─── 1. Project name ──────────────────────────────
    const projectName = await ask(rl, "Project name", scan.projectName ?? "my-project");

    // ─── 2. Description ──────────────────────────────
    const defaultDesc = scan.description?.split("\n")[0]?.slice(0, 100) ?? "";
    const description = await ask(rl, "Description", defaultDesc || "");

    // ─── 3. Domain ───────────────────────────────────
    const suggestedDomain = suggestDomain(scan);
    const domainDefault = DOMAIN_OPTIONS.indexOf(suggestedDomain);
    const domainIdx = await askChoice(rl, "Project domain:", DOMAIN_OPTIONS, domainDefault >= 0 ? domainDefault : DOMAIN_OPTIONS.length - 1);
    const domain = DOMAIN_OPTIONS[domainIdx];

    // ─── 4. Compliance standards ─────────────────────
    const complianceStandards: ComplianceStandard[] = [];
    const defaultCompliance = scan.complianceHints;
    if (defaultCompliance.length > 0) {
      console.error(chalk.cyan(`  Detected compliance hints: ${defaultCompliance.join(", ")}`));
    }
    const addCompliance = await askYN(rl, "Configure compliance standards?", defaultCompliance.length > 0);
    if (addCompliance) {
      const standardOptions = ["IEC 62443", "OWASP", "CRA", "ISO 27001", "SOC 2", "GDPR", "HIPAA", "NIST"];
      const defaultIdxs = defaultCompliance
        .map((h) => standardOptions.findIndex((s) => s.toUpperCase() === h.toUpperCase()))
        .filter((i) => i >= 0);
      const selected = await askMultiChoice(rl, "Select standards:", standardOptions, defaultIdxs);
      for (const idx of selected) {
        const standard: ComplianceStandard = { id: standardOptions[idx].toLowerCase().replace(/\s+/g, "-") };
        // Ask for level for IEC 62443
        if (standardOptions[idx] === "IEC 62443") {
          const level = await ask(rl, "IEC 62443 Security Level", "SL2");
          if (level) standard.level = level;
        }
        complianceStandards.push(standard);
      }
    }

    // ─── 5. AIOS location ────────────────────────────
    let aiosPathCandidate: string | null = options.aiosPath ?? detectAiosPath(cwd);
    if (aiosPathCandidate) {
      console.error(chalk.cyan(`  Detected AIOS at: ${aiosPathCandidate}`));
      const confirm = await askYN(rl, "Use this path?", true);
      if (!confirm) aiosPathCandidate = null;
    }
    if (!aiosPathCandidate) {
      aiosPathCandidate = await ask(rl, "Path to AIOS installation", detectAiosPath(cwd) ?? "../AIOS");
    }
    const aiosPath = resolve(cwd, aiosPathCandidate);

    // ─── 6. Provider routing ─────────────────────────
    const routing: Record<string, string> = {};
    const configureProviders = await askYN(rl, "Configure provider routing?", false);
    if (configureProviders) {
      const providers = ["anthropic", "ollama", "openai", "gemini"];
      const complexIdx = await askChoice(rl, "Provider for complex tasks:", providers, 0);
      routing["complex"] = providers[complexIdx];
      const quickIdx = await askChoice(rl, "Provider for quick tasks:", providers, complexIdx);
      routing["quick"] = providers[quickIdx];
    }

    // ─── 7. Discover available personas ─────────────
    const allPersonas = discoverAllPersonas(aiosPath);
    if (allPersonas.length > 0) {
      console.error(chalk.cyan(`  Verfügbare Personas: ${allPersonas.length}`));
      console.error(chalk.gray(`    ${allPersonas.join(", ")}`));
      console.error(chalk.gray("    (Team wird dynamisch pro Task zusammengestellt)"));
      console.error();
    }

    // ─── 8. Read-only warning ────────────────────────
    console.error();
    console.error(chalk.yellow("  ⚠️  AIOS Read-Only Protection"));
    console.error(chalk.gray("  By default, the generated agent instructions will tell AI agents"));
    console.error(chalk.gray("  that the AIOS directory is READ-ONLY — agents should never modify"));
    console.error(chalk.gray("  files inside AIOS when working on this project."));
    console.error();
    console.error(chalk.gray("  Instead, project-specific pattern overrides go into .aios/patterns/"));
    console.error();
    const readOnly = await askYN(rl, "Enable AIOS read-only protection? (recommended)", true);

    // ─── 9. Summary + confirm ────────────────────────
    console.error();
    console.error(chalk.bold("  Summary:"));
    console.error(chalk.gray(`    Project:     ${projectName}`));
    console.error(chalk.gray(`    Domain:      ${domain}`));
    console.error(chalk.gray(`    Language:    ${scan.language}`));
    console.error(chalk.gray(`    AIOS path:   ${aiosPath}`));
    console.error(chalk.gray(`    Read-only:   ${readOnly ? "Yes" : "No"}`));
    console.error(chalk.gray(`    Personas:    ${allPersonas.length} verfügbar (dynamische Zuweisung)`));
    if (complianceStandards.length > 0) {
      console.error(chalk.gray(`    Compliance:  ${complianceStandards.map((s) => s.id).join(", ")}`));
    }
    if (Object.keys(routing).length > 0) {
      console.error(chalk.gray(`    Routing:     ${Object.entries(routing).map(([k, v]) => `${k}→${v}`).join(", ")}`));
    }
    console.error();

    if (!options.yes) {
      const confirm = await askYN(rl, "Proceed with this configuration?", true);
      if (!confirm) {
        console.error(chalk.yellow("  Aborted."));
        return null;
      }
    }

    rl.close();

    return createDefaultContext({
      project: {
        name: projectName,
        description,
        domain,
        language: scan.language,
        repo: scan.gitRemote,
      },
      aios: {
        path: aiosPath,
        readOnly,
      },
      compliance: {
        standards: complianceStandards,
        requireTraceability: complianceStandards.length > 0,
        requireTestCoverage: scan.hasTests,
        minimumCoverage: scan.hasTests ? 80 : undefined,
      },
      personas: {
        active: allPersonas,
        inactive: [],
      },
      providers: { routing },
      knowledge: {
        autoIndex: existsSync(join(cwd, "REQUIREMENTS.md"))
          ? ["REQUIREMENTS.md", "docs/**/*.md"]
          : ["docs/**/*.md"],
        autoExtract: false,
      },
    });
  } catch (err) {
    rl.close();
    throw err;
  }
}

// ─── Quick Mode ──────────────────────────────────────────

function buildQuickContext(
  scan: ScanResult,
  cwd: string,
  aiosPathOverride?: string,
): AiosContext {
  const aiosPath = aiosPathOverride
    ? resolve(cwd, aiosPathOverride)
    : detectAiosPath(cwd) ?? resolve(cwd, "..", "AIOS");

  const domain = suggestDomain(scan);
  const compliance: ComplianceStandard[] = scan.complianceHints.map((h) => ({
    id: h.toLowerCase().replace(/\s+/g, "-"),
  }));
  const allPersonas = discoverAllPersonas(aiosPath);

  return createDefaultContext({
    project: {
      name: scan.projectName ?? "unnamed-project",
      description: scan.description?.split("\n")[0]?.slice(0, 200) ?? "",
      domain,
      language: scan.language,
      repo: scan.gitRemote,
    },
    aios: {
      path: aiosPath,
      readOnly: true,
    },
    compliance: {
      standards: compliance,
      requireTraceability: compliance.length > 0,
      requireTestCoverage: scan.hasTests,
      minimumCoverage: scan.hasTests ? 80 : undefined,
    },
    personas: {
      active: allPersonas,
      inactive: [],
    },
    providers: { routing: {} },
    knowledge: {
      autoIndex: ["docs/**/*.md"],
      autoExtract: false,
    },
  });
}
