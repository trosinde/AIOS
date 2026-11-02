import { existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

/**
 * Find the AIOS installation root.
 *
 * Checked in order; the first directory that looks like an AIOS checkout
 * (has both patterns/ and src/) wins. `~/.aios/repo` comes first because
 * that is where install.sh puts the clone.
 */
export function detectAiosPath(cwd: string): string | null {
  for (const candidate of aiosPathCandidates(cwd)) {
    if (existsSync(join(candidate, "patterns")) && existsSync(join(candidate, "src"))) {
      return candidate;
    }
  }
  return null;
}

/** The candidate list, exported so callers can show it in error messages. */
export function aiosPathCandidates(cwd: string): string[] {
  return [
    join(homedir(), ".aios", "repo"),
    resolve(cwd, "..", "AIOS"),
    resolve(cwd, "..", "aios"),
    join(homedir(), "tools", "AIOS"),
    join(homedir(), "AIOS"),
    join(homedir(), ".local", "share", "aios"),
  ];
}
