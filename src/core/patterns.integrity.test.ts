import { describe, it, expect } from "vitest";
import { join } from "path";
import { PatternRegistry } from "./registry.js";

const PATTERNS_DIR = join(process.cwd(), "patterns");

describe("Pattern Integrity – CI Gate", () => {
  const registry = new PatternRegistry(PATTERNS_DIR);
  const allNames = new Set(registry.list());

  it("alle Patterns haben kernel_abi gesetzt", () => {
    const missing: string[] = [];
    for (const p of registry.all()) {
      if (!p.meta.kernel_abi) missing.push(p.meta.name);
    }
    expect(missing, `Patterns ohne kernel_abi: ${missing.join(", ")}`).toEqual([]);
  });

  it("alle Patterns haben category gesetzt", () => {
    const missing: string[] = [];
    for (const p of registry.all()) {
      if (p.meta.internal) continue;
      if (!p.meta.category || p.meta.category === "uncategorized") {
        missing.push(p.meta.name);
      }
    }
    expect(missing, `Patterns ohne category: ${missing.join(", ")}`).toEqual([]);
  });

  it("can_follow Referenzen zeigen auf existierende Patterns", () => {
    const broken: string[] = [];
    for (const p of registry.all()) {
      for (const ref of p.meta.can_follow ?? []) {
        if (!allNames.has(ref)) {
          broken.push(`${p.meta.name}.can_follow → "${ref}"`);
        }
      }
    }
    expect(broken, `Kaputte can_follow Referenzen:\n${broken.join("\n")}`).toEqual([]);
  });

  it("can_precede Referenzen zeigen auf existierende Patterns", () => {
    const broken: string[] = [];
    for (const p of registry.all()) {
      for (const ref of p.meta.can_precede ?? []) {
        if (!allNames.has(ref)) {
          broken.push(`${p.meta.name}.can_precede → "${ref}"`);
        }
      }
    }
    expect(broken, `Kaputte can_precede Referenzen:\n${broken.join("\n")}`).toEqual([]);
  });

  it("parallelizable_with Referenzen zeigen auf existierende Patterns", () => {
    const broken: string[] = [];
    for (const p of registry.all()) {
      for (const ref of p.meta.parallelizable_with ?? []) {
        if (!allNames.has(ref)) {
          broken.push(`${p.meta.name}.parallelizable_with → "${ref}"`);
        }
      }
    }
    expect(broken, `Kaputte parallelizable_with Referenzen:\n${broken.join("\n")}`).toEqual([]);
  });

  it("type:internal Patterns haben internal_op gesetzt", () => {
    const missing: string[] = [];
    for (const p of registry.all()) {
      if (p.meta.type === "internal" && !p.meta.internal_op) {
        missing.push(p.meta.name);
      }
    }
    expect(missing, `Internal-Patterns ohne internal_op: ${missing.join(", ")}`).toEqual([]);
  });

  it("type:tool Patterns haben tool oder driver gesetzt", () => {
    const missing: string[] = [];
    for (const p of registry.all()) {
      if (p.meta.type === "tool" && !p.meta.tool && !p.meta.driver) {
        missing.push(p.meta.name);
      }
    }
    expect(missing, `Tool-Patterns ohne tool/driver: ${missing.join(", ")}`).toEqual([]);
  });
});
