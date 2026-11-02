import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { readdirSync, existsSync } from "fs";
import { join } from "path";

/**
 * Static gate for the host-forensics scripts.
 *
 * Nothing else in the suite looks at ~3700 lines of bash and PowerShell, and
 * both languages fail in ways a reader misses: a GNU-only sed construct that
 * silently yields nothing on macOS, or a `(try { … } catch { … })` that
 * parses fine and only fails at runtime. These two checks are cheap and are
 * pure regression protection — both pass today.
 *
 * They skip when the tool is absent, because CI may not have shellcheck or
 * pwsh installed and a skipped check is better than a red one for the wrong
 * reason.
 */

const SCRIPTS = join(process.cwd(), ".claude", "skills", "host-forensics", "scripts");

function has(bin: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf-8" }).status === 0;
}

const shellScripts = existsSync(SCRIPTS)
  ? readdirSync(SCRIPTS).filter(f => f.endsWith(".sh")).sort()
  : [];
const psScripts = existsSync(SCRIPTS)
  ? readdirSync(SCRIPTS).filter(f => f.endsWith(".ps1")).sort()
  : [];

describe("host-forensics scripts — static checks", () => {
  it("has shell and PowerShell scripts to check", () => {
    expect(shellScripts.length).toBeGreaterThan(0);
    expect(psScripts.length).toBeGreaterThan(0);
  });

  it.each(shellScripts)("%s parses as bash", (file) => {
    const r = spawnSync("bash", ["-n", join(SCRIPTS, file)], { encoding: "utf-8" });
    expect(r.stderr || "", `bash -n ${file}`).toBe("");
    expect(r.status).toBe(0);
  });

  it.skipIf(!has("shellcheck"))("every shell script is clean at shellcheck warning severity", () => {
    const r = spawnSync(
      "shellcheck",
      ["-S", "warning", "-s", "bash", "-x", ...shellScripts.map(f => join(SCRIPTS, f))],
      { encoding: "utf-8", cwd: SCRIPTS },
    );
    expect(r.stdout + r.stderr, "shellcheck findings at warning+ severity").toBe("");
    expect(r.status).toBe(0);
  });

  it.skipIf(!has("pwsh"))("every PowerShell script parses", () => {
    const script = `
      $bad = @()
      foreach ($f in @(${psScripts.map(f => `'${join(SCRIPTS, f)}'`).join(",")})) {
        $e = $null
        $null = [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$e)
        if ($e) { foreach ($x in $e) { $bad += ("{0}:{1}: {2}" -f (Split-Path -Leaf $f), $x.Extent.StartLineNumber, $x.Message) } }
      }
      $bad -join "\`n"
    `;
    const r = spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf-8" });
    expect((r.stdout || "").trim(), "PowerShell parse errors").toBe("");
  });

  it.skipIf(!has("pwsh"))("no PowerShell script uses try/catch as an expression", () => {
    // `$x = (try { … } catch { … })` and `$a += (try { … } catch { … })`
    // PARSE cleanly and fail only at runtime, where an outer catch swallows
    // them. `$x = try { … } catch { … }` works on pwsh 7 but cannot be
    // verified on Windows PowerShell 5.1, which is what powershell.exe is.
    // Every such site goes through the Invoke-Probe helper instead.
    const offenders: string[] = [];
    for (const f of psScripts) {
      const text = spawnSync("cat", [join(SCRIPTS, f)], { encoding: "utf-8" }).stdout ?? "";
      text.split("\n").forEach((line, i) => {
        if (/(=|\+=)\s*\(?\s*try\s*\{/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no shell script sources a file from the examined system", () => {
    // `. /etc/os-release` executes the file. On a compromised host — the case
    // this tool exists for — that is code execution as root during evidence
    // collection, and it breaks the skill's first rule ("read only").
    const offenders: string[] = [];
    for (const f of shellScripts) {
      const text = spawnSync("cat", [join(SCRIPTS, f)], { encoding: "utf-8" }).stdout ?? "";
      text.split("\n").forEach((line, i) => {
        const code = line.replace(/#.*$/, "");
        // Allowed: sourcing our own lib.sh via $HF_SCRIPT_DIR.
        if (/^\s*(\.|source)\s+/.test(code) && !/HF_SCRIPT_DIR/.test(code)) {
          offenders.push(`${f}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
