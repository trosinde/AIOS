import {
  existsSync, mkdirSync, readdirSync, readFileSync,
  copyFileSync, lstatSync, symlinkSync, readlinkSync, cpSync,
} from "fs";
import { join, dirname, resolve, sep, basename, relative } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import type { ContextConfig } from "../types.js";
import { parseContextYaml } from "./schema.js";
import { generate } from "./generator.js";

// ─── Types ───────────────────────────────────────────────

/** A symlink the template wants in the workspace, pointing into the AIOS install. */
export interface TemplateLink {
  /** Path inside the workspace, relative, e.g. ".claude/skills/host-forensics" */
  path: string;
  /** Path inside the AIOS install, relative, e.g. ".claude/skills/host-forensics" */
  target: string;
}

export interface TemplateManifest {
  name: string;
  description: string;
  /** Empty directories to create (e.g. cases/, tools/) */
  dirs?: string[];
  /** Symlinks into the AIOS install, so `aios update` propagates changes */
  links?: TemplateLink[];
  /** Lines printed after a successful apply */
  next_steps?: string[];
}

export interface ApplyTemplateOptions {
  name: string;
  cwd: string;
  /** Defaults to <aios-repo>/templates/workspaces */
  templatesRoot?: string;
  /** AIOS install root; needed for `links`. Without it, links are skipped. */
  aiosRoot?: string | null;
  /** Replaces {{name}} in the template's context.yaml. Defaults to basename(cwd). */
  workspaceName?: string;
}

export interface ApplyTemplateResult {
  created: string[];
  modified: string[];
  skipped: string[];
  links: string[];
  warnings: string[];
  manifest: TemplateManifest;
  context: ContextConfig;
}

export interface TemplateSummary {
  name: string;
  description: string;
}

// ─── Constants ───────────────────────────────────────────

/**
 * Files whose names start with this prefix are written with a leading dot.
 * Keeping `.gitignore` and `.aios/` dotted inside the repo would make them
 * active there (a template's .gitignore would apply to the template folder).
 */
const DOT_PREFIX = "dot-";

/** The manifest itself is configuration, not workspace content. */
const MANIFEST_FILE = "template.yaml";

/** Template names are used in paths, so keep them boring. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// ─── Paths ───────────────────────────────────────────────

/** <aios-repo>/templates/workspaces — works from src/ (tsx) and dist/ alike. */
export function defaultTemplatesRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "templates", "workspaces");
}

/**
 * True when `target` is inside `base`.
 *
 * Deliberately not a bare startsWith: that would accept "/srv/aios-evil"
 * for base "/srv/aios". The separator check is what makes it a containment
 * test rather than a prefix test.
 */
function isWithin(target: string, base: string): boolean {
  const b = resolve(base);
  const t = resolve(target);
  return t === b || t.startsWith(b.endsWith(sep) ? b : b + sep);
}

function assertWithin(target: string, base: string, what: string): void {
  if (!isWithin(target, base)) {
    throw new Error(`Path traversal blocked: ${what} "${target}" is outside "${base}"`);
  }
}

// ─── Discovery ───────────────────────────────────────────

export function listTemplates(templatesRoot = defaultTemplatesRoot()): TemplateSummary[] {
  if (!existsSync(templatesRoot)) return [];
  const out: TemplateSummary[] = [];
  for (const entry of readdirSync(templatesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!NAME_PATTERN.test(entry.name)) continue;
    try {
      const manifest = readManifest(join(templatesRoot, entry.name));
      out.push({ name: manifest.name, description: manifest.description });
    } catch {
      // A template with a broken manifest is not offered.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function readManifest(templateDir: string): TemplateManifest {
  const path = join(templateDir, MANIFEST_FILE);
  if (!existsSync(path)) {
    throw new Error(`Template has no ${MANIFEST_FILE}: ${templateDir}`);
  }
  const parsed = parseYaml(readFileSync(path, "utf-8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid ${MANIFEST_FILE} in ${templateDir}: not an object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name) {
    throw new Error(`Invalid ${MANIFEST_FILE} in ${templateDir}: name is required`);
  }
  if (!NAME_PATTERN.test(obj.name)) {
    throw new Error(`Invalid ${MANIFEST_FILE} in ${templateDir}: name must match ${NAME_PATTERN}`);
  }

  const dirs = Array.isArray(obj.dirs) ? obj.dirs.filter((d): d is string => typeof d === "string") : undefined;
  const links = Array.isArray(obj.links)
    ? obj.links.flatMap((l): TemplateLink[] => {
        if (!l || typeof l !== "object") return [];
        const { path: p, target } = l as Record<string, unknown>;
        if (typeof p !== "string" || typeof target !== "string") return [];
        return [{ path: p, target }];
      })
    : undefined;
  const nextSteps = Array.isArray(obj.next_steps)
    ? obj.next_steps.filter((s): s is string => typeof s === "string")
    : undefined;

  return {
    name: obj.name,
    description: typeof obj.description === "string" ? obj.description : "",
    ...(dirs ? { dirs } : {}),
    ...(links ? { links } : {}),
    ...(nextSteps ? { next_steps: nextSteps } : {}),
  };
}

// ─── Apply ───────────────────────────────────────────────

/**
 * Copy a workspace template into `cwd`.
 *
 * The template owns the content; this function is only the mechanism. It
 * never overwrites an existing file — those are reported as `skipped`, so
 * re-running on a populated directory is safe.
 */
export function applyTemplate(options: ApplyTemplateOptions): ApplyTemplateResult {
  const { name, cwd } = options;
  const templatesRoot = options.templatesRoot ?? defaultTemplatesRoot();

  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid template name "${name}". Allowed: lowercase letters, digits, hyphen.`);
  }
  const templateDir = join(templatesRoot, name);
  assertWithin(templateDir, templatesRoot, "template directory");
  if (!existsSync(templateDir)) {
    const available = listTemplates(templatesRoot).map(t => t.name);
    throw new Error(
      `Unknown template "${name}". Available: ${available.length ? available.join(", ") : "(none)"}`,
    );
  }

  const manifest = readManifest(templateDir);

  // Applying a workspace template inside the AIOS installation itself would
  // turn the install into a workspace: it writes .aios/, .env and the
  // template's CLAUDE.md over the repository's own. Nobody wants that, and
  // it is easy to trigger with a stray `cd`.
  if (options.aiosRoot && resolve(cwd) === resolve(options.aiosRoot)) {
    throw new Error(
      `Refusing to apply template "${name}" inside the AIOS installation itself ` +
      `(${resolve(cwd)}). Create a separate working directory and run it there:\n` +
      `  mkdir ~/forensik && cd ~/forensik && aios init --template ${name}`,
    );
  }
  if (existsSync(join(cwd, "templates", "workspaces")) && existsSync(join(cwd, "patterns")) && existsSync(join(cwd, "src"))) {
    throw new Error(
      `Refusing to apply template "${name}": ${resolve(cwd)} looks like the AIOS ` +
      `repository, not a working directory. Create a separate directory and run it there.`,
    );
  }

  const result: ApplyTemplateResult = {
    created: [], modified: [], skipped: [], links: [], warnings: [],
    manifest,
    context: {} as ContextConfig,
  };

  // ─── 1. context.yaml from the template drives the standard .aios tree ───
  const workspaceName = options.workspaceName ?? (basename(resolve(cwd)) || name);
  const templateContextPath = join(templateDir, `${DOT_PREFIX}aios`, "context.yaml");
  if (!existsSync(templateContextPath)) {
    throw new Error(`Template "${name}" has no ${DOT_PREFIX}aios/context.yaml`);
  }
  const rendered = readFileSync(templateContextPath, "utf-8").replace(/\{\{name\}\}/g, workspaceName);
  const context = parseContextYaml(rendered);
  if (options.aiosRoot) {
    context.aios = { path: options.aiosRoot, readOnly: context.aios?.readOnly ?? true };
  }
  result.context = context;

  // generate() writes .aios/context.yaml, agent-instructions.md and the
  // knowledge tree. CLAUDE.md comes from the template, so it is not patched.
  const generated = generate(context, { cwd, patchClaudeMd: false });
  result.created.push(...generated.created);
  result.modified.push(...generated.modified);
  result.skipped.push(...generated.skipped);

  // ─── 2. Copy the rest of the template ───────────────────────────────────
  // context.yaml ist schon von generate() geschrieben worden, sonst würde es
  // hier als "skipped" auftauchen und die Zusammenfassung verrauschen.
  copyTree(templateDir, cwd, templateDir, cwd, result, [join(`${DOT_PREFIX}aios`, "context.yaml")]);

  // ─── 3. Empty directories the workspace needs ──────────────────────────
  for (const dir of manifest.dirs ?? []) {
    const target = join(cwd, dir);
    assertWithin(target, cwd, "template dir");
    if (!existsSync(target)) {
      mkdirSync(target, { recursive: true });
      result.created.push(target);
    } else {
      result.skipped.push(target);
    }
  }

  // ─── 4. Symlinks into the AIOS install ─────────────────────────────────
  for (const link of manifest.links ?? []) {
    applyLink(link, cwd, options.aiosRoot ?? null, result);
  }

  return result;
}

/** Map a template file name to its workspace name (dot- prefix → leading dot). */
function mapName(entryName: string): string {
  return entryName.startsWith(DOT_PREFIX)
    ? "." + entryName.slice(DOT_PREFIX.length)
    : entryName;
}

function copyTree(
  srcDir: string,
  destDir: string,
  templateRoot: string,
  cwdRoot: string,
  result: ApplyTemplateResult,
  excludeRelative: string[],
): void {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === MANIFEST_FILE) continue;

    const srcPath = join(srcDir, entry.name);
    const srcRelative = relative(templateRoot, srcPath);
    if (excludeRelative.includes(srcRelative)) continue;

    const destPath = join(destDir, mapName(entry.name));
    assertWithin(destPath, cwdRoot, "template file");

    if (entry.isDirectory()) {
      if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
      copyTree(srcPath, destPath, templateRoot, cwdRoot, result, excludeRelative);
      continue;
    }
    if (!entry.isFile()) {
      // Symlinks and special files in a template are not copied; links are
      // declared in template.yaml so their target is validated.
      result.warnings.push(`Skipped non-regular file in template: ${srcPath}`);
      continue;
    }

    if (existsSync(destPath)) {
      result.skipped.push(destPath);
      continue;
    }
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(srcPath, destPath);
    result.created.push(destPath);
  }
}

function applyLink(
  link: TemplateLink,
  cwd: string,
  aiosRoot: string | null,
  result: ApplyTemplateResult,
): void {
  const linkPath = join(cwd, link.path);
  assertWithin(linkPath, cwd, "link path");

  if (!aiosRoot) {
    result.warnings.push(
      `No AIOS installation found — "${link.path}" was not created. ` +
      `Re-run with --aios-path <path>, or link it yourself: ` +
      `ln -s <aios>/${link.target} ${link.path}`,
    );
    return;
  }

  const targetPath = join(aiosRoot, link.target);
  assertWithin(targetPath, aiosRoot, "link target");
  if (!existsSync(targetPath)) {
    result.warnings.push(
      `Link target does not exist in the AIOS installation: ${targetPath} — "${link.path}" was not created.`,
    );
    return;
  }

  if (existsSync(linkPath) || isDanglingSymlink(linkPath)) {
    // Already pointing at the right place? Then there is nothing to do.
    try {
      if (lstatSync(linkPath).isSymbolicLink() && resolve(dirname(linkPath), readlinkSync(linkPath)) === resolve(targetPath)) {
        result.skipped.push(linkPath);
        return;
      }
    } catch {
      // fall through to the generic skip below
    }
    result.skipped.push(linkPath);
    result.warnings.push(
      `"${link.path}" already exists and was left alone. Expected it to point at ${targetPath}.`,
    );
    return;
  }

  mkdirSync(dirname(linkPath), { recursive: true });
  try {
    // Absolute target: the link keeps working no matter where it is used from,
    // and `aios update` changes the skill in place.
    symlinkSync(resolve(targetPath), linkPath, "dir");
    result.links.push(`${linkPath} -> ${targetPath}`);
  } catch (err) {
    // Windows needs Developer Mode or elevation for symlinks. Copying keeps
    // the workspace usable, but updates no longer propagate — say so.
    try {
      cpSync(targetPath, linkPath, { recursive: true });
      result.created.push(linkPath);
      result.warnings.push(
        `Could not create a symlink for "${link.path}" (${err instanceof Error ? err.message : String(err)}). ` +
        `Copied it instead — "aios update" will NOT update this copy. ` +
        `Enable Developer Mode on Windows, or re-create the link manually, to get updates.`,
      );
    } catch (copyErr) {
      result.warnings.push(
        `Neither a symlink nor a copy worked for "${link.path}": ` +
        `${copyErr instanceof Error ? copyErr.message : String(copyErr)}`,
      );
    }
  }
}

function isDanglingSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Relative paths for display, so the summary stays readable. */
export function relativize(paths: string[], cwd: string): string[] {
  return paths.map(p => {
    const r = relative(cwd, p);
    return r && !r.startsWith("..") ? r : p;
  });
}

/** Writes nothing; used by tests and by `aios init --list-templates`. */
export function describeTemplate(name: string, templatesRoot = defaultTemplatesRoot()): TemplateManifest {
  if (!NAME_PATTERN.test(name)) throw new Error(`Invalid template name "${name}"`);
  const dir = join(templatesRoot, name);
  assertWithin(dir, templatesRoot, "template directory");
  return readManifest(dir);
}
