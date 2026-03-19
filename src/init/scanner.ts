import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

// ─── Types ───────────────────────────────────────────────

export interface ScanResult {
  projectName: string | null;
  description: string | null;
  language: "typescript" | "javascript" | "python" | "rust" | "go" | "mixed" | "unknown";
  moduleSystem: "esm" | "commonjs" | "unknown";
  hasTests: boolean;
  testFramework: string | null;
  hasCi: boolean;
  ciTool: string | null;
  gitRemote: string | null;
  sourceFileCount: number;
  existingAios: boolean;
  existingClaudeMd: boolean;
  complianceHints: string[];
  detectedFrameworks: string[];
}

// ─── Ignored directories ─────────────────────────────────

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "__pycache__", ".mypy_cache", ".pytest_cache", "target",
  "vendor", ".venv", "venv", "env", ".tox", "coverage",
]);

// ─── Scanner ─────────────────────────────────────────────

/**
 * Deterministic analysis of a project directory.
 * No LLM calls. Returns structured ScanResult.
 * Never throws — unknown fields stay null.
 */
export function scanProject(cwd: string): ScanResult {
  const result: ScanResult = {
    projectName: null,
    description: null,
    language: "unknown",
    moduleSystem: "unknown",
    hasTests: false,
    testFramework: null,
    hasCi: false,
    ciTool: null,
    gitRemote: null,
    sourceFileCount: 0,
    existingAios: false,
    existingClaudeMd: false,
    complianceHints: [],
    detectedFrameworks: [],
  };

  // ─── Existing .aios/ and CLAUDE.md ──────────────────
  result.existingAios = existsSync(join(cwd, ".aios"));
  result.existingClaudeMd = existsSync(join(cwd, "CLAUDE.md"));

  // ─── package.json ───────────────────────────────────
  const pkgJson = readJsonSafe(join(cwd, "package.json"));
  if (pkgJson) {
    result.projectName = pkgJson.name ?? null;
    result.description = pkgJson.description ?? null;
    result.moduleSystem = pkgJson.type === "module" ? "esm" : "commonjs";

    const allDeps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };

    // Language detection from tsconfig or TS deps
    if (existsSync(join(cwd, "tsconfig.json")) || allDeps["typescript"]) {
      result.language = "typescript";
    } else {
      result.language = "javascript";
    }

    // Test framework detection
    if (allDeps["vitest"]) {
      result.hasTests = true;
      result.testFramework = "vitest";
    } else if (allDeps["jest"]) {
      result.hasTests = true;
      result.testFramework = "jest";
    } else if (allDeps["mocha"]) {
      result.hasTests = true;
      result.testFramework = "mocha";
    }

    // Framework detection
    detectJsFrameworks(allDeps, result.detectedFrameworks);
  }

  // ─── Python (pyproject.toml / setup.py) ─────────────
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "setup.py"))) {
    result.language = result.language !== "unknown" && result.language !== "python" ? "mixed" : "python";
    if (!result.projectName) {
      result.projectName = readPyProjectName(join(cwd, "pyproject.toml"));
    }
    // pytest detection
    if (existsSync(join(cwd, "pyproject.toml"))) {
      const pyContent = readFileSafe(join(cwd, "pyproject.toml"));
      if (pyContent?.includes("pytest")) {
        result.hasTests = true;
        result.testFramework = result.testFramework ?? "pytest";
      }
    }
    if (existsSync(join(cwd, "tests")) || existsSync(join(cwd, "test"))) {
      result.hasTests = true;
      result.testFramework = result.testFramework ?? "pytest";
    }
  }

  // ─── Rust (Cargo.toml) ──────────────────────────────
  if (existsSync(join(cwd, "Cargo.toml"))) {
    result.language = result.language !== "unknown" && result.language !== "rust" ? "mixed" : "rust";
    if (!result.projectName) {
      const cargoContent = readFileSafe(join(cwd, "Cargo.toml"));
      const nameMatch = cargoContent?.match(/^name\s*=\s*"(.+?)"/m);
      if (nameMatch) result.projectName = nameMatch[1];
    }
    result.hasTests = true; // Rust always has test infrastructure
    result.testFramework = result.testFramework ?? "cargo test";
  }

  // ─── Go (go.mod) ────────────────────────────────────
  if (existsSync(join(cwd, "go.mod"))) {
    result.language = result.language !== "unknown" && result.language !== "go" ? "mixed" : "go";
    if (!result.projectName) {
      const goContent = readFileSafe(join(cwd, "go.mod"));
      const modMatch = goContent?.match(/^module\s+(.+)/m);
      if (modMatch) {
        const parts = modMatch[1].trim().split("/");
        result.projectName = parts[parts.length - 1];
      }
    }
    // Check for _test.go files
    const goTestFiles = countFilesRecursive(cwd, "_test.go");
    if (goTestFiles > 0) {
      result.hasTests = true;
      result.testFramework = result.testFramework ?? "go test";
    }
  }

  // ─── tsconfig.json details ──────────────────────────
  const tsconfig = readJsonSafe(join(cwd, "tsconfig.json"));
  if (tsconfig?.compilerOptions) {
    const mod = tsconfig.compilerOptions.module?.toLowerCase();
    if (mod?.includes("esnext") || mod?.includes("es20") || mod?.includes("nodenext")) {
      result.moduleSystem = "esm";
    } else if (mod?.includes("commonjs")) {
      result.moduleSystem = "commonjs";
    }
  }

  // ─── Git remote ─────────────────────────────────────
  const gitConfig = readFileSafe(join(cwd, ".git", "config"));
  if (gitConfig) {
    const remoteMatch = gitConfig.match(/url\s*=\s*(.+)/);
    if (remoteMatch) result.gitRemote = remoteMatch[1].trim();
  }

  // ─── README.md (description + compliance) ──────────
  if (!result.description) {
    const readme = readFileSafe(join(cwd, "README.md"));
    if (readme) {
      result.description = readme.slice(0, 500).trim();
    }
  }

  // ─── Source file count ──────────────────────────────
  const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"]);
  result.sourceFileCount = countSourceFiles(cwd, sourceExts);

  // ─── CI/CD detection ───────────────────────────────
  if (existsSync(join(cwd, ".github", "workflows"))) {
    result.hasCi = true;
    result.ciTool = "github-actions";
  } else if (existsSync(join(cwd, ".gitlab-ci.yml"))) {
    result.hasCi = true;
    result.ciTool = "gitlab-ci";
  } else if (existsSync(join(cwd, "Jenkinsfile"))) {
    result.hasCi = true;
    result.ciTool = "jenkins";
  } else if (existsSync(join(cwd, ".circleci"))) {
    result.hasCi = true;
    result.ciTool = "circleci";
  }

  // ─── Compliance hints ──────────────────────────────
  scanComplianceHints(cwd, result.complianceHints);

  return result;
}

// ─── Helpers ─────────────────────────────────────────────

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function readJsonSafe(path: string): Record<string, any> | null {
  const content = readFileSafe(path);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function readPyProjectName(path: string): string | null {
  const content = readFileSafe(path);
  if (!content) return null;
  const nameMatch = content.match(/^name\s*=\s*"(.+?)"/m);
  return nameMatch ? nameMatch[1] : null;
}

function detectJsFrameworks(deps: Record<string, any>, frameworks: string[]): void {
  const frameworkMap: Record<string, string> = {
    "next": "nextjs",
    "react": "react",
    "vue": "vue",
    "@angular/core": "angular",
    "express": "express",
    "@nestjs/core": "nestjs",
    "fastify": "fastify",
    "svelte": "svelte",
    "nuxt": "nuxt",
    "astro": "astro",
    "hono": "hono",
  };
  for (const [dep, name] of Object.entries(frameworkMap)) {
    if (dep in deps) frameworks.push(name);
  }
}

function countSourceFiles(dir: string, exts: Set<string>): number {
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countSourceFiles(fullPath, exts);
      } else if (entry.isFile() && exts.has(extname(entry.name))) {
        count++;
      }
    }
  } catch {
    // Permission errors etc.
  }
  return count;
}

function countFilesRecursive(dir: string, suffix: string): number {
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFilesRecursive(fullPath, suffix);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        count++;
      }
    }
  } catch {
    // Permission errors etc.
  }
  return count;
}

function scanComplianceHints(cwd: string, hints: string[]): void {
  const complianceKeywords = [
    "IEC 62443", "IEC62443",
    "OWASP",
    "CRA", "Cyber Resilience Act",
    "ISO 27001", "ISO27001",
    "SOC 2", "SOC2",
    "GDPR", "DSGVO",
    "HIPAA",
    "PCI DSS", "PCI-DSS",
    "NIST",
  ];

  const filesToScan = ["README.md", "SECURITY.md", "COMPLIANCE.md"];
  const docsDir = join(cwd, "docs");

  for (const file of filesToScan) {
    const content = readFileSafe(join(cwd, file));
    if (content) {
      for (const keyword of complianceKeywords) {
        if (content.toUpperCase().includes(keyword.toUpperCase()) && !hints.includes(normalizeCompliance(keyword))) {
          hints.push(normalizeCompliance(keyword));
        }
      }
    }
  }

  // Scan docs/ directory top-level files
  if (existsSync(docsDir)) {
    try {
      const docFiles = readdirSync(docsDir).filter((f) => f.endsWith(".md"));
      for (const file of docFiles.slice(0, 10)) { // limit to 10 files
        const content = readFileSafe(join(docsDir, file));
        if (content) {
          for (const keyword of complianceKeywords) {
            if (content.toUpperCase().includes(keyword.toUpperCase()) && !hints.includes(normalizeCompliance(keyword))) {
              hints.push(normalizeCompliance(keyword));
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

function normalizeCompliance(keyword: string): string {
  const map: Record<string, string> = {
    "IEC62443": "IEC 62443",
    "ISO27001": "ISO 27001",
    "SOC2": "SOC 2",
    "PCI-DSS": "PCI DSS",
    "DSGVO": "GDPR",
    "Cyber Resilience Act": "CRA",
  };
  return map[keyword] ?? keyword;
}
