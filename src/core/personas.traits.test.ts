import { describe, it, expect } from "vitest";
import { join } from "path";
import { PersonaRegistry } from "./personas.js";
import { loadBaseTraits, validatePersona } from "./trait-validator.js";

/**
 * Kernel-Gate: JEDE geladene Persona im Repo MUSS das Base Trait Protocol
 * im system_prompt referenzieren. Dieser Test schlägt fehl, sobald eine neue
 * Persona ohne Handoff/Trace-Instruktionen committet wird.
 *
 * Fix bei Failure: aios persona validate <name> lokal ausführen und den
 * Base-Trait-Block zum system_prompt ergänzen (siehe scripts/migrate-persona-traits.ts).
 */
describe("Repo-Personas vs. Base Trait Protocol", () => {
  const personasDir = join(process.cwd(), "personas");
  const traits = loadBaseTraits(personasDir);
  const registry = new PersonaRegistry(personasDir);
  const personas = registry.all();

  it("lädt Base Traits aus personas/kernel/base_traits.yaml", () => {
    expect(traits).not.toBeNull();
    expect(traits?.kernel_abi).toBe(1);
  });

  it("findet mindestens eine Persona im Repo", () => {
    expect(personas.length).toBeGreaterThan(0);
  });

  it.each(personas.map(p => [p.id, p]))(
    "Persona %s erfüllt alle required Base Traits",
    (_id, persona) => {
      expect(traits).not.toBeNull();
      const report = validatePersona(persona.id, persona.system_prompt ?? "", traits!);
      const missingRequired = report.results
        .filter(r => r.required && !r.found)
        .map(r => r.trait);
      expect(
        missingRequired,
        `Persona "${persona.id}" fehlt required Traits: ${missingRequired.join(", ")}. ` +
          `Ergänze Base-Trait-Block im system_prompt.`,
      ).toEqual([]);
    },
  );
});
