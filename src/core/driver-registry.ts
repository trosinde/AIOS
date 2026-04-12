import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve, isAbsolute, dirname, extname, basename } from "path";
import { execFileSync } from "child_process";
import { homedir } from "os";
import { parse as parseYaml } from "yaml";
import type {
  DriverDefinition,
  DriverOperation,
  DriverBinding,
  LoadedDriver,
} from "../types.js";

/**
 * Tool-Driver-Registry.
 *
 * Zweck: Stabiles ABI zwischen AIOS-Kernel und externen CLI-Tools.
 * Kernel kennt nur das Driver-Schema (diese Datei), nie konkrete Tool-
 * Semantik. Konkrete Driver (z.B. mermaid) liegen im User Space unter
 * drivers/<name>/driver.yaml.
 *
 * 4-Ebenen-Lookup (erste gewinnt):
 *   1. ~/.aios/kernel/drivers/      (globale Benutzer-Overrides)
 *   2. <context>/.aios/drivers/     (Context-lokale Driver)
 *   3. <repo>/drivers/              (Repo-mitgelieferte Driver)
 *   4. KERNEL_DRIVERS_DIR env var   (nur für Tests)
 *
 * Hard-Fail-Semantik (Phase 5 Empfehlung):
 *   - kernel_abi != 1 → Error
 *   - version_min unterschritten → Error bei ersten Verwendung (cached)
 *   - Binary nicht im PATH → Error bei ersten Verwendung
 */

export const CURRENT_DRIVER_ABI = 1;

export class DriverLoadError extends Error {
  constructor(message: string, public driverName?: string) {
    super(message);
    this.name = "DriverLoadError";
  }
}

export class DriverValidationError extends Error {
  constructor(message: string, public driverName: string, public operation: string) {
    super(message);
    this.name = "DriverValidationError";
  }
}

export interface DriverRegistryOptions {
  repoRoot?: string;        // Wo liegt <repo>/drivers/
  contextDir?: string;      // Wo liegt <context>/.aios/drivers/
  homeDir?: string;         // Override für Tests
}

interface ResolvedArgs {
  argv: string[];
  tempInputs: { path: string; binding: string }[];  // für evtl. Cleanup
  outputFiles: Record<string, string>;              // Name → absolute path
}

export class DriverRegistry {
  private drivers = new Map<string, LoadedDriver>();
  private versionCheckCache = new Map<string, { passed: boolean; version?: string; error?: string }>();

  constructor(opts: DriverRegistryOptions = {}) {
    const home = opts.homeDir ?? homedir();
    const lookupDirs: string[] = [];

    const envDir = process.env.KERNEL_DRIVERS_DIR;
    if (envDir) lookupDirs.push(envDir);

    lookupDirs.push(join(home, ".aios", "kernel", "drivers"));
    if (opts.contextDir) lookupDirs.push(join(opts.contextDir, ".aios", "drivers"));
    if (opts.repoRoot) lookupDirs.push(join(opts.repoRoot, "drivers"));

    for (const dir of lookupDirs) {
      this.loadDirectory(dir);
    }
  }

  private loadDirectory(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const driverPath = join(dir, entry, "driver.yaml");
      if (!existsSync(driverPath)) continue;
      try {
        this.loadDriverFile(driverPath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new DriverLoadError(`Driver ${entry} in ${dir} ungültig: ${msg}`, entry);
      }
    }
  }

  private loadDriverFile(path: string): void {
    const raw = readFileSync(path, "utf-8");
    const def = parseYaml(raw) as DriverDefinition;

    if (!def || typeof def !== "object") {
      throw new DriverLoadError(`Leere oder ungültige Driver-Datei: ${path}`);
    }
    if (def.kernel_abi !== CURRENT_DRIVER_ABI) {
      throw new DriverLoadError(
        `kernel_abi mismatch: Driver ${def.name ?? "?"} erwartet ABI ${def.kernel_abi}, Kernel unterstützt ${CURRENT_DRIVER_ABI}`,
        def.name,
      );
    }
    if (!def.name || !def.binary || !def.operations) {
      throw new DriverLoadError(`Driver unvollständig (name/binary/operations): ${path}`);
    }
    if (Object.keys(def.operations).length === 0) {
      throw new DriverLoadError(`Driver ${def.name} hat keine operations definiert: ${path}`);
    }

    // First-win: wenn bereits geladen, überspringen (höhere Priorität gewinnt)
    if (this.drivers.has(def.name)) return;

    this.drivers.set(def.name, { def, sourcePath: path });
  }

  get(name: string): LoadedDriver | undefined {
    return this.drivers.get(name);
  }

  list(): LoadedDriver[] {
    return [...this.drivers.values()];
  }

  /**
   * Lazy Version-Check: erst beim ersten Gebrauch, dann gecached.
   * Hard-Fail wenn Binary fehlt oder zu alt.
   */
  assertAvailable(driverName: string): void {
    const loaded = this.drivers.get(driverName);
    if (!loaded) {
      throw new DriverLoadError(`Driver "${driverName}" nicht gefunden`, driverName);
    }
    const cached = this.versionCheckCache.get(driverName);
    if (cached) {
      if (!cached.passed) {
        throw new DriverLoadError(
          `Driver "${driverName}" nicht verfügbar: ${cached.error}`,
          driverName,
        );
      }
      return;
    }

    const { def } = loaded;
    const versionCmd = def.version_command ?? ["--version"];
    let version: string | undefined;
    try {
      const out = execFileSync(def.binary, versionCmd, {
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
      version = extractSemver(out);
    } catch (e) {
      const error = `Binary ${def.binary} nicht ausführbar (${e instanceof Error ? e.message : e})`;
      this.versionCheckCache.set(driverName, { passed: false, error });
      throw new DriverLoadError(`Driver "${driverName}" nicht verfügbar: ${error}`, driverName);
    }

    if (def.version_min) {
      if (!version) {
        const error = `version_min=${def.version_min} gefordert, aber keine SemVer aus "${def.binary} ${versionCmd.join(" ")}" lesbar`;
        this.versionCheckCache.set(driverName, { passed: false, error });
        throw new DriverLoadError(`Driver "${driverName}" nicht verfügbar: ${error}`, driverName);
      }
      if (compareSemver(version, def.version_min) < 0) {
        const error = `Version ${version} < version_min ${def.version_min}`;
        this.versionCheckCache.set(driverName, { passed: false, error });
        throw new DriverLoadError(`Driver "${driverName}" nicht verfügbar: ${error}`, driverName);
      }
    }

    loaded.detectedVersion = version;
    this.versionCheckCache.set(driverName, { passed: true, version });
  }

  /**
   * Bindet Pattern-Inputs gegen eine Operation-Signatur und resolved
   * das argv-Template. Wirft DriverValidationError bei Verstoß.
   *
   * @param inputValues  Keys aus operation.inputs → konkrete Werte (Pfade, Strings)
   * @param outputPaths  Keys aus operation.outputs → wohin geschrieben werden soll
   */
  resolveArgv(
    driverName: string,
    operationName: string,
    inputValues: Record<string, string | string[]>,
    outputPaths: Record<string, string>,
  ): ResolvedArgs {
    const loaded = this.drivers.get(driverName);
    if (!loaded) {
      throw new DriverValidationError(
        `Driver "${driverName}" nicht gefunden`,
        driverName,
        operationName,
      );
    }
    const op = loaded.def.operations[operationName];
    if (!op) {
      throw new DriverValidationError(
        `Operation "${operationName}" in Driver "${driverName}" nicht definiert. Verfügbar: ${Object.keys(loaded.def.operations).join(", ")}`,
        driverName,
        operationName,
      );
    }

    const resolvedInputs: Record<string, string | string[]> = {};
    for (const [name, binding] of Object.entries(op.inputs ?? {})) {
      const raw = inputValues[name] ?? binding.default;
      if (raw === undefined || raw === null) {
        throw new DriverValidationError(
          `Input "${name}" fehlt (kein Wert, kein default)`,
          driverName,
          operationName,
        );
      }
      resolvedInputs[name] = validateInputBinding(name, binding, raw, driverName, operationName);
    }

    const resolvedOutputs: Record<string, string> = {};
    for (const [name, binding] of Object.entries(op.outputs ?? {})) {
      const raw = outputPaths[name];
      if (raw === undefined) {
        throw new DriverValidationError(
          `Output "${name}" wurde von der Engine nicht gebunden`,
          driverName,
          operationName,
        );
      }
      resolvedOutputs[name] = validateOutputBinding(name, binding, raw, driverName, operationName);
    }

    const argv: string[] = [];
    for (const tok of op.argv) {
      if (tok.startsWith("$")) {
        const key = tok.slice(1);
        if (key in resolvedInputs) {
          const val = resolvedInputs[key];
          if (Array.isArray(val)) {
            argv.push(...val);
          } else {
            argv.push(val);
          }
        } else if (key in resolvedOutputs) {
          argv.push(resolvedOutputs[key]);
        } else {
          throw new DriverValidationError(
            `argv-Template verweist auf unbekannten Key $${key}`,
            driverName,
            operationName,
          );
        }
      } else {
        argv.push(tok);
      }
    }

    return { argv, tempInputs: [], outputFiles: resolvedOutputs };
  }

  /** Operation-Definition für Sandbox-Lookup (timeout etc.) */
  getOperation(driverName: string, operationName: string): DriverOperation | undefined {
    return this.drivers.get(driverName)?.def.operations[operationName];
  }
}

// ─── Validation Helpers ──────────────────────────────────

const SHELL_METACHAR = /[;&|`$<>\n\r\0]/;

function assertNoShellMeta(value: string, name: string, driver: string, op: string): void {
  if (SHELL_METACHAR.test(value)) {
    throw new DriverValidationError(
      `Input "${name}" enthält Shell-Metazeichen, Pfad/Wert abgelehnt`,
      driver,
      op,
    );
  }
}

function normalizeExt(ext: string | string[] | undefined): string[] | undefined {
  if (!ext) return undefined;
  return Array.isArray(ext) ? ext : [ext];
}

function validateInputBinding(
  name: string,
  binding: DriverBinding,
  raw: string | string[] | number,
  driver: string,
  op: string,
): string | string[] {
  switch (binding.type) {
    case "file": {
      const p = String(raw);
      assertNoShellMeta(p, name, driver, op);
      const abs = isAbsolute(p) ? p : resolve(p);
      const mustExist = binding.must_exist ?? true;
      if (mustExist && !existsSync(abs)) {
        throw new DriverValidationError(`Input "${name}": Datei ${abs} existiert nicht`, driver, op);
      }
      const allowed = normalizeExt(binding.ext);
      if (allowed) {
        const ext = extname(abs).replace(/^\./, "").toLowerCase();
        if (!allowed.includes(ext)) {
          throw new DriverValidationError(
            `Input "${name}": Extension .${ext} nicht erlaubt (erwartet: ${allowed.join(", ")})`,
            driver,
            op,
          );
        }
      }
      return abs;
    }
    case "file_list": {
      const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      if (binding.min !== undefined && list.length < binding.min) {
        throw new DriverValidationError(
          `Input "${name}": ${list.length} Dateien, minimum ${binding.min}`,
          driver,
          op,
        );
      }
      if (binding.max !== undefined && list.length > binding.max) {
        throw new DriverValidationError(
          `Input "${name}": ${list.length} Dateien, maximum ${binding.max}`,
          driver,
          op,
        );
      }
      const mustExist = binding.must_exist ?? true;
      const allowed = normalizeExt(binding.ext);
      const resolved: string[] = [];
      for (const p of list) {
        assertNoShellMeta(p, name, driver, op);
        const abs = isAbsolute(p) ? p : resolve(p);
        if (mustExist && !existsSync(abs)) {
          throw new DriverValidationError(`Input "${name}": Datei ${abs} existiert nicht`, driver, op);
        }
        if (allowed) {
          const ext = extname(abs).replace(/^\./, "").toLowerCase();
          if (!allowed.includes(ext)) {
            throw new DriverValidationError(
              `Input "${name}": ${basename(abs)} hat Extension .${ext}, erwartet ${allowed.join(", ")}`,
              driver,
              op,
            );
          }
        }
        resolved.push(abs);
      }
      return resolved;
    }
    case "directory": {
      const p = String(raw);
      assertNoShellMeta(p, name, driver, op);
      const abs = isAbsolute(p) ? p : resolve(p);
      if (binding.must_exist !== false) {
        if (!existsSync(abs) || !statSync(abs).isDirectory()) {
          throw new DriverValidationError(`Input "${name}": Verzeichnis ${abs} existiert nicht`, driver, op);
        }
      }
      return abs;
    }
    case "string": {
      const s = String(raw);
      assertNoShellMeta(s, name, driver, op);
      return s;
    }
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new DriverValidationError(`Input "${name}": kein gültiger Zahlenwert (${raw})`, driver, op);
      }
      return String(n);
    }
    default:
      throw new DriverValidationError(
        `Input "${name}": unbekannter Typ "${(binding as DriverBinding).type}"`,
        driver,
        op,
      );
  }
}

function validateOutputBinding(
  name: string,
  binding: DriverBinding,
  raw: string,
  driver: string,
  op: string,
): string {
  const p = String(raw);
  assertNoShellMeta(p, name, driver, op);
  const abs = isAbsolute(p) ? p : resolve(p);
  if (binding.type === "file") {
    const allowed = normalizeExt(binding.ext);
    if (allowed) {
      const ext = extname(abs).replace(/^\./, "").toLowerCase();
      if (!allowed.includes(ext)) {
        throw new DriverValidationError(
          `Output "${name}": Extension .${ext} nicht erlaubt (erwartet: ${allowed.join(", ")})`,
          driver,
          op,
        );
      }
    }
    // Parent-Directory muss existieren (Engine legt es vorher an)
    const parent = dirname(abs);
    if (!existsSync(parent)) {
      throw new DriverValidationError(
        `Output "${name}": Parent-Verzeichnis ${parent} existiert nicht`,
        driver,
        op,
      );
    }
  } else if (binding.type === "directory") {
    if (!existsSync(abs)) {
      throw new DriverValidationError(
        `Output "${name}": Verzeichnis ${abs} existiert nicht`,
        driver,
        op,
      );
    }
  }
  return abs;
}

// ─── SemVer Helpers ──────────────────────────────────────

/** Extrahiert die erste SemVer-artige Zeichenkette aus Tool-Output. */
export function extractSemver(text: string): string | undefined {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : undefined;
}

/** -1 wenn a<b, 0 wenn a==b, +1 wenn a>b. Akzeptiert "1.2.3". */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(n => parseInt(n, 10));
  const pb = b.split(".").map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}
