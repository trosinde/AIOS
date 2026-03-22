import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { PersonaRegistry } from "./personas.js";

describe("PersonaRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join("/tmp", `personas-test-${crypto.randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePersona(filename: string, content: string): void {
    writeFileSync(join(tmpDir, filename), content, "utf-8");
  }

  it("loads .yaml persona files", () => {
    writePersona("dev.yaml", `
id: developer
name: Developer
role: Code implementation
description: Writes code
system_prompt: You are a developer.
expertise: [typescript, testing]
preferred_patterns: [code_review]
communicates_with: [tester]
`);

    const registry = new PersonaRegistry(tmpDir);
    expect(registry.list()).toContain("developer");
    expect(registry.get("developer")?.name).toBe("Developer");
  });

  it("loads .yml persona files", () => {
    writePersona("arch.yml", `
id: architect
name: Architect
role: System design
description: Designs systems
system_prompt: You are an architect.
expertise: [architecture]
preferred_patterns: [design_review]
communicates_with: [developer]
`);

    const registry = new PersonaRegistry(tmpDir);
    expect(registry.list()).toContain("architect");
  });

  it("loads multiple personas", () => {
    writePersona("a.yaml", "id: alpha\nname: Alpha\nrole: A\ndescription: A\nsystem_prompt: A\nexpertise: []\npreferred_patterns: []\ncommunicates_with: []");
    writePersona("b.yaml", "id: beta\nname: Beta\nrole: B\ndescription: B\nsystem_prompt: B\nexpertise: []\npreferred_patterns: []\ncommunicates_with: []");

    const registry = new PersonaRegistry(tmpDir);
    expect(registry.all()).toHaveLength(2);
    expect(registry.list()).toEqual(expect.arrayContaining(["alpha", "beta"]));
  });

  it("returns undefined for unknown persona", () => {
    const registry = new PersonaRegistry(tmpDir);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("handles non-existent directory gracefully", () => {
    const registry = new PersonaRegistry(join(tmpDir, "does-not-exist"));
    expect(registry.all()).toHaveLength(0);
    expect(registry.list()).toHaveLength(0);
  });

  it("skips files without id field", () => {
    writePersona("noid.yaml", "name: NoId\nrole: Test\ndescription: Missing id");

    const registry = new PersonaRegistry(tmpDir);
    expect(registry.all()).toHaveLength(0);
  });

  it("skips corrupt YAML files", () => {
    writePersona("bad.yaml", ":::invalid yaml {{{");
    writePersona("good.yaml", "id: good\nname: Good\nrole: R\ndescription: D\nsystem_prompt: S\nexpertise: []\npreferred_patterns: []\ncommunicates_with: []");

    const registry = new PersonaRegistry(tmpDir);
    expect(registry.list()).toEqual(["good"]);
  });

  it("ignores non-yaml files", () => {
    writePersona("readme.md", "# Not a persona");
    writePersona("data.json", '{"id": "json"}');
    writePersona("valid.yaml", "id: valid\nname: Valid\nrole: R\ndescription: D\nsystem_prompt: S\nexpertise: []\npreferred_patterns: []\ncommunicates_with: []");

    const registry = new PersonaRegistry(tmpDir);
    expect(registry.list()).toEqual(["valid"]);
  });

  it("all() returns persona objects", () => {
    writePersona("dev.yaml", `
id: dev
name: Developer
role: Code
description: Writes code
system_prompt: prompt
expertise: [ts]
preferred_patterns: [review]
communicates_with: [tester]
`);

    const registry = new PersonaRegistry(tmpDir);
    const all = registry.all();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("dev");
    expect(all[0].expertise).toContain("ts");
  });
});
