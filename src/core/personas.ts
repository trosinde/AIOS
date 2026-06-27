import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import type { Persona } from "../types.js";

/**
 * PersonaRegistry – lädt alle personas/*.yaml Dateien.
 * Personas definieren WER eine Aufgabe ausführt (Rolle, Expertise, Arbeitsweise).
 * Patterns definieren WAS getan wird (Aufgabe, Steps, Output-Format).
 */
export class PersonaRegistry {
  private personas = new Map<string, Persona>();

  /**
   * @param personasDirs Ein oder mehrere Verzeichnisse. Bei mehreren werden sie
   * in Reihenfolge geladen; spätere überschreiben gleichnamige IDs früherer.
   * Konvention: `[global, context-lokal]` → context-lokal hat Vorrang
   * (gleiche Semantik wie der Context-Lookup für Patterns).
   */
  constructor(personasDirs: string | string[]) {
    for (const dir of Array.isArray(personasDirs) ? personasDirs : [personasDirs]) {
      this.loadAll(dir);
    }
  }

  private loadAll(dir: string): void {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      try {
        const raw = readFileSync(join(dir, file), "utf-8");
        const data = parse(raw) as Persona;
        if (data.id) {
          this.personas.set(data.id, data);
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  get(id: string): Persona | undefined {
    return this.personas.get(id);
  }

  all(): Persona[] {
    return [...this.personas.values()];
  }

  list(): string[] {
    return [...this.personas.keys()];
  }
}
