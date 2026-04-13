import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { DriverRegistry, DriverLoadError, DriverValidationError, extractSemver, compareSemver } from "./driver-registry.js";

function mkRepo(): string {
  const dir = join("/tmp", `driver-test-${crypto.randomUUID()}`);
  mkdirSync(join(dir, "drivers"), { recursive: true });
  return dir;
}

function writeDriver(repo: string, name: string, yaml: string): void {
  const dir = join(repo, "drivers", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "driver.yaml"), yaml, "utf-8");
}

const VALID_MERMAID = `
kernel_abi: 1
name: mermaid
binary: mmdc
capabilities: [file_read, file_write]
operations:
  render:
    inputs:
      source:
        type: file
        ext: [mmd, txt]
        must_exist: true
    outputs:
      target:
        type: file
        ext: [svg, png]
    argv: ["-i", "$source", "-o", "$target", "-t", "dark"]
sandbox:
  timeout_sec: 30
`;

describe("DriverRegistry – loading", () => {
  let repo: string;

  beforeEach(() => { repo = mkRepo(); });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it("lädt einen gültigen Driver aus <repo>/drivers/", () => {
    writeDriver(repo, "mermaid", VALID_MERMAID);
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    const loaded = reg.get("mermaid");
    expect(loaded).toBeDefined();
    expect(loaded!.def.name).toBe("mermaid");
    expect(loaded!.def.binary).toBe("mmdc");
    expect(loaded!.def.operations.render.argv).toContain("-t");
  });

  it("weist kernel_abi-Mismatch hart zurück", () => {
    writeDriver(repo, "bad", VALID_MERMAID.replace("kernel_abi: 1", "kernel_abi: 2"));
    expect(() => new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" }))
      .toThrow(DriverLoadError);
  });

  it("weist Driver ohne name/binary/operations zurück", () => {
    writeDriver(repo, "incomplete", `kernel_abi: 1\nname: incomplete\n`);
    expect(() => new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" }))
      .toThrow(/unvollständig|operations/);
  });

  it("weist Driver mit leeren operations zurück", () => {
    writeDriver(repo, "empty", `kernel_abi: 1\nname: empty\nbinary: x\ncapabilities: []\noperations: {}\n`);
    expect(() => new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" }))
      .toThrow(/keine operations/);
  });

  it("ignoriert Verzeichnisse ohne driver.yaml", () => {
    mkdirSync(join(repo, "drivers", "not_a_driver"), { recursive: true });
    writeDriver(repo, "mermaid", VALID_MERMAID);
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    expect(reg.list().map(d => d.def.name)).toEqual(["mermaid"]);
  });
});

describe("DriverRegistry – argv resolution", () => {
  let repo: string;
  let reg: DriverRegistry;
  let tmpSource: string;

  beforeEach(() => {
    repo = mkRepo();
    writeDriver(repo, "mermaid", VALID_MERMAID);
    reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    tmpSource = join(repo, "input.mmd");
    writeFileSync(tmpSource, "graph TD; A-->B", "utf-8");
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it("resolved Input/Output in argv-Template", () => {
    const outPath = join(repo, "out.svg");
    const { argv } = reg.resolveArgv(
      "mermaid",
      "render",
      { source: tmpSource },
      { target: outPath },
    );
    expect(argv).toEqual(["-i", tmpSource, "-o", outPath, "-t", "dark"]);
  });

  it("lehnt Shell-Metazeichen in Input ab", () => {
    expect(() =>
      reg.resolveArgv("mermaid", "render", { source: `${tmpSource}; rm -rf /` }, { target: join(repo, "x.svg") }),
    ).toThrow(DriverValidationError);
  });

  it("lehnt falsche Extension im Input ab", () => {
    const bad = join(repo, "input.exe");
    writeFileSync(bad, "x");
    expect(() =>
      reg.resolveArgv("mermaid", "render", { source: bad }, { target: join(repo, "out.svg") }),
    ).toThrow(/Extension/);
  });

  it("lehnt nicht existierenden Input ab", () => {
    expect(() =>
      reg.resolveArgv("mermaid", "render", { source: "/does/not/exist.mmd" }, { target: join(repo, "out.svg") }),
    ).toThrow(/existiert nicht/);
  });

  it("lehnt falsche Extension im Output ab", () => {
    expect(() =>
      reg.resolveArgv("mermaid", "render", { source: tmpSource }, { target: join(repo, "out.exe") }),
    ).toThrow(/Extension/);
  });

  it("lehnt Output-Pfad mit fehlendem Parent-Dir ab", () => {
    expect(() =>
      reg.resolveArgv("mermaid", "render", { source: tmpSource }, { target: "/nonexistent-dir-xyz/out.svg" }),
    ).toThrow(/Parent-Verzeichnis/);
  });

  it("wirft Error für unbekannte Operation", () => {
    expect(() =>
      reg.resolveArgv("mermaid", "unknown_op", { source: tmpSource }, {}),
    ).toThrow(/nicht definiert/);
  });

  it("wirft Error für unbekannten Driver", () => {
    expect(() =>
      reg.resolveArgv("nonexistent", "render", {}, {}),
    ).toThrow(/nicht gefunden/);
  });

  it("wirft Error bei fehlendem Pflicht-Input", () => {
    expect(() =>
      reg.resolveArgv("mermaid", "render", {}, { target: join(repo, "out.svg") }),
    ).toThrow(/fehlt/);
  });
});

describe("DriverRegistry – file_list binding", () => {
  let repo: string;
  let reg: DriverRegistry;

  beforeEach(() => {
    repo = mkRepo();
    writeDriver(repo, "multi", `
kernel_abi: 1
name: multi
binary: cat
capabilities: [file_read]
operations:
  concat:
    inputs:
      files:
        type: file_list
        ext: [txt]
        min: 2
        max: 5
    outputs:
      dest:
        type: file
        ext: [txt]
    argv: ["$files", "$dest"]
`);
    reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    writeFileSync(join(repo, "a.txt"), "a");
    writeFileSync(join(repo, "b.txt"), "b");
    writeFileSync(join(repo, "c.txt"), "c");
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it("expandiert file_list in argv", () => {
    const { argv } = reg.resolveArgv(
      "multi", "concat",
      { files: [join(repo, "a.txt"), join(repo, "b.txt")] },
      { dest: join(repo, "out.txt") },
    );
    expect(argv).toEqual([
      join(repo, "a.txt"),
      join(repo, "b.txt"),
      join(repo, "out.txt"),
    ]);
  });

  it("erzwingt min-Anzahl", () => {
    expect(() => reg.resolveArgv(
      "multi", "concat",
      { files: [join(repo, "a.txt")] },
      { dest: join(repo, "out.txt") },
    )).toThrow(/minimum 2/);
  });

  it("erzwingt max-Anzahl", () => {
    const files = ["a", "b", "c"].map(x => join(repo, `${x}.txt`));
    // write 3 more to have 6 total
    for (const f of ["d", "e", "f"]) {
      writeFileSync(join(repo, `${f}.txt`), "x");
      files.push(join(repo, `${f}.txt`));
    }
    expect(() => reg.resolveArgv(
      "multi", "concat",
      { files },
      { dest: join(repo, "out.txt") },
    )).toThrow(/maximum 5/);
  });
});

describe("DriverRegistry – assertAvailable", () => {
  let repo: string;

  beforeEach(() => { repo = mkRepo(); });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it("wirft Fehler für nicht geladenen Driver", () => {
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    expect(() => reg.assertAvailable("nonexistent")).toThrow(DriverLoadError);
    expect(() => reg.assertAvailable("nonexistent")).toThrow("nicht gefunden");
  });

  it("cached fehlgeschlagene Version-Checks", () => {
    // Use a driver with a non-existent binary to guarantee failure
    writeDriver(repo, "fakecli", VALID_MERMAID.replace("name: mermaid", "name: fakecli").replace("binary: mmdc", "binary: nonexistent-binary-xyz-12345"));
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    // First call fails because binary doesn't exist
    try { reg.assertAvailable("fakecli"); } catch { /* expected */ }
    // Second call should use cache and still throw
    expect(() => reg.assertAvailable("fakecli")).toThrow("nicht verfügbar");
  });
});

describe("DriverRegistry – priority (first-win)", () => {
  let repo1: string;
  let repo2: string;

  beforeEach(() => {
    repo1 = mkRepo();
    repo2 = mkRepo();
  });
  afterEach(() => {
    rmSync(repo1, { recursive: true, force: true });
    rmSync(repo2, { recursive: true, force: true });
  });

  it("erster geladener Driver gewinnt bei Namenskollision", () => {
    // KERNEL_DRIVERS_DIR has highest priority (loaded first)
    writeDriver(repo1, "mermaid", VALID_MERMAID);
    writeDriver(repo2, "mermaid", VALID_MERMAID.replace("binary: mmdc", "binary: other-mmdc"));

    const origEnv = process.env.KERNEL_DRIVERS_DIR;
    process.env.KERNEL_DRIVERS_DIR = join(repo1, "drivers");
    try {
      const reg = new DriverRegistry({ repoRoot: repo2, homeDir: "/nonexistent" });
      const loaded = reg.get("mermaid");
      // First loaded (from KERNEL_DRIVERS_DIR) wins
      expect(loaded!.def.binary).toBe("mmdc");
    } finally {
      if (origEnv === undefined) delete process.env.KERNEL_DRIVERS_DIR;
      else process.env.KERNEL_DRIVERS_DIR = origEnv;
    }
  });
});

describe("DriverRegistry – getOperation", () => {
  let repo: string;

  beforeEach(() => { repo = mkRepo(); });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it("gibt Operation-Definition zurück", () => {
    writeDriver(repo, "mermaid", VALID_MERMAID);
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    const op = reg.getOperation("mermaid", "render");
    expect(op).toBeDefined();
    expect(op!.argv).toContain("-i");
  });

  it("gibt undefined für unbekannte Operation", () => {
    writeDriver(repo, "mermaid", VALID_MERMAID);
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    expect(reg.getOperation("mermaid", "nonexistent")).toBeUndefined();
  });

  it("gibt undefined für unbekannten Driver", () => {
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    expect(reg.getOperation("nonexistent", "render")).toBeUndefined();
  });
});

describe("DriverRegistry – directory + string + number bindings", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkRepo();
    writeDriver(repo, "converter", `
kernel_abi: 1
name: converter
binary: convert
capabilities: [file_read]
operations:
  transform:
    inputs:
      dir:
        type: directory
        must_exist: true
      label:
        type: string
      count:
        type: number
    outputs: {}
    argv: ["--dir", "$dir", "--label", "$label", "--count", "$count"]
`);
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it("resolved directory, string und number Inputs", () => {
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    const { argv } = reg.resolveArgv(
      "converter", "transform",
      { dir: repo, label: "test-label", count: "42" },
      {},
    );
    expect(argv).toContain(repo);
    expect(argv).toContain("test-label");
    expect(argv).toContain("42");
  });

  it("wirft bei nicht-existierendem Directory", () => {
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    expect(() => reg.resolveArgv(
      "converter", "transform",
      { dir: "/nonexistent-dir-xyz", label: "x", count: "1" },
      {},
    )).toThrow(/existiert nicht/);
  });

  it("wirft bei ungültigem Zahlenwert", () => {
    const reg = new DriverRegistry({ repoRoot: repo, homeDir: "/nonexistent" });
    expect(() => reg.resolveArgv(
      "converter", "transform",
      { dir: repo, label: "x", count: "not-a-number" },
      {},
    )).toThrow(/kein gültiger Zahlenwert/);
  });
});

describe("SemVer helpers", () => {
  it("extrahiert SemVer aus Tool-Output", () => {
    expect(extractSemver("mmdc 11.4.2\n")).toBe("11.4.2");
    expect(extractSemver("version 1.0.0 (build abc)")).toBe("1.0.0");
    expect(extractSemver("no version here")).toBeUndefined();
  });

  it("vergleicht SemVer korrekt", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("2.0.0", "1.0.0")).toBe(1);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
    expect(compareSemver("10.0.0", "9.9.9")).toBe(1);
  });
});
