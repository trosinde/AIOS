import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Repo-wide gate for the host-forensics tool catalog, in the same spirit as
 * personas.traits.test.ts (gates personas/*.yaml) and registry.test.ts
 * (gates patterns/*&#47;system.md).
 *
 * Why this earns a test: the catalog is parsed twice, by two different
 * languages, and both parsers drop a malformed row in SILENCE.
 *
 *   fetch-tools.sh   awk -F'\t' '/^#/ {next} NF < 10 {next} ...'
 *   fetch-tools.ps1  if ($c.Count -lt 10) { return }
 *
 * So a single missing tab makes a forensic tool vanish from the install set
 * with no error and exit code 0 — the collection quietly loses a capability.
 * An extra tab is worse: it is not filtered at all, the columns shift, and
 * `digest_source` becomes garbage, which sends checksum verification down
 * the "unknown digest_source" path for that one row.
 */

const CATALOG = join(process.cwd(), ".claude", "skills", "host-forensics", "tools.catalog.tsv");

const COLUMNS = [
  "id", "os", "arch", "version", "url", "digest_source", "extract", "entry", "license", "purpose",
] as const;

const VALID_OS = new Set(["linux", "darwin", "windows", "any"]);
const VALID_ARCH = new Set(["x86_64", "aarch64", "arm", "x86", "any"]);
const VALID_EXTRACT = new Set(["zip", "targz", "gz", "none"]);

interface Row {
  line: number;
  fields: string[];
  get: (c: (typeof COLUMNS)[number]) => string;
}

function readRows(): Row[] {
  const raw = readFileSync(CATALOG, "utf-8");
  return raw
    .split("\n")
    .map((text, i) => ({ text, line: i + 1 }))
    .filter(({ text }) => text.trim() !== "" && !text.startsWith("#"))
    .map(({ text, line }) => {
      const fields = text.split("\t");
      return {
        line,
        fields,
        get: (c) => fields[COLUMNS.indexOf(c)] ?? "",
      };
    });
}

describe("host-forensics tool catalog", () => {
  it("exists where both fetch-tools scripts look for it", () => {
    expect(existsSync(CATALOG)).toBe(true);
  });

  const rows = existsSync(CATALOG) ? readRows() : [];

  it("has data rows", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(rows.map(r => [r.line, r]))(
    "line %i has exactly 10 tab-separated fields",
    (_line, row) => {
      // Both parsers skip a short row in silence; a long row shifts columns.
      expect(
        row.fields.length,
        `expected ${COLUMNS.length} fields, got ${row.fields.length}: ${row.fields[0]}`,
      ).toBe(COLUMNS.length);
    },
  );

  it.each(rows.map(r => [r.get("id") + " " + r.get("os") + "/" + r.get("arch"), r]))(
    "%s has a usable https source and a known extract type",
    (_label, row) => {
      expect(row.get("id")).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
      expect(VALID_OS.has(row.get("os")), `os: ${row.get("os")}`).toBe(true);
      expect(VALID_ARCH.has(row.get("arch")), `arch: ${row.get("arch")}`).toBe(true);
      expect(row.get("version").trim()).not.toBe("");
      // fetch-tools refuses anything but https; a non-https row would only
      // ever produce a runtime error.
      expect(row.get("url")).toMatch(/^https:\/\//);
      expect(VALID_EXTRACT.has(row.get("extract")), `extract: ${row.get("extract")}`).toBe(true);
      expect(row.get("entry").trim()).not.toBe("");
      expect(row.get("license").trim()).not.toBe("");
      expect(row.get("purpose").trim()).not.toBe("");
    },
  );

  it.each(rows.map(r => [r.get("id") + " " + r.get("os") + "/" + r.get("arch"), r]))(
    "%s declares a digest_source the scripts understand",
    (_label, row) => {
      const ds = row.get("digest_source");
      const known = ds === "gh-api" || ds === "none" || ds.startsWith("https://");
      expect(known, `digest_source: ${ds}`).toBe(true);
      // github_asset_digest() only parses GitHub release-download URLs, so a
      // gh-api row pointing elsewhere can never resolve a checksum and would
      // silently need --allow-unpinned.
      if (ds === "gh-api") {
        expect(row.get("url")).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//);
      }
    },
  );

  it("has no duplicate (id, os, arch) key", () => {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const r of rows) {
      const key = `${r.get("id")}|${r.get("os")}|${r.get("arch")}`;
      if (seen.has(key)) dupes.push(`${key} (lines ${seen.get(key)} and ${r.line})`);
      else seen.set(key, r.line);
    }
    // A duplicate would install twice and leave lock.tsv describing whichever
    // row happened to run last.
    expect(dupes).toEqual([]);
  });

  it("documents every catalogued tool id in references/tools.md", () => {
    const docs = readFileSync(
      join(process.cwd(), ".claude", "skills", "host-forensics", "references", "tools.md"),
      "utf-8",
    );
    const ids = [...new Set(rows.map(r => r.get("id")))];
    const undocumented = ids.filter(id => {
      // yara-forge-core / -extended are documented under the project name.
      const base = id.replace(/-(core|extended|win)$/, "");
      return !docs.includes(id) && !docs.toLowerCase().includes(base.toLowerCase());
    });
    expect(undocumented).toEqual([]);
  });
});

describe("host-forensics skill layout", () => {
  const SKILL_DIR = join(process.cwd(), ".claude", "skills", "host-forensics");

  it("every script in scripts/ is mentioned in SKILL.md or a reference", () => {
    // A script nobody is told about is a script nobody runs — and the
    // Windows-native tool fetcher is easy to forget.
    const skillText = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
    const refDir = join(SKILL_DIR, "references");
    const refText = readdirSync(refDir)
      .map(f => readFileSync(join(refDir, f), "utf-8"))
      .join("\n");
    const prose = skillText + "\n" + refText;

    const scripts = readdirSync(join(SKILL_DIR, "scripts"))
      .filter(f => f.endsWith(".sh") || f.endsWith(".ps1"))
      // lib.sh is sourced by the others, never called directly.
      .filter(f => f !== "lib.sh");

    const unmentioned = scripts.filter(f => !prose.includes(f));
    expect(unmentioned).toEqual([]);
  });

  it("every script mentioned in SKILL.md exists", () => {
    const skillText = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
    const referenced = [...skillText.matchAll(/scripts[/\\]([A-Za-z0-9._-]+\.(?:sh|ps1))/g)]
      .map(m => m[1]!);
    const missing = [...new Set(referenced)].filter(
      f => !existsSync(join(SKILL_DIR, "scripts", f)),
    );
    expect(missing).toEqual([]);
  });

  it("every reference file linked from SKILL.md exists", () => {
    const skillText = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
    const referenced = [...skillText.matchAll(/references[/\\]([A-Za-z0-9._-]+\.md)/g)]
      .map(m => m[1]!);
    const missing = [...new Set(referenced)].filter(
      f => !existsSync(join(SKILL_DIR, "references", f)),
    );
    expect(missing).toEqual([]);
  });
});
