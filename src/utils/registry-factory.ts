import { PatternRegistry } from "../core/registry.js";
import { ContextManager } from "../core/context.js";

/**
 * Build a PatternRegistry using the 4-level context-aware lookup order:
 * 1. .aios/patterns/ (project-local, highest priority)
 * 2. ~/.aios/contexts/<active>/patterns/ (context-specific)
 * 3. Repository patterns (repoPatternsDir)
 * 4. ~/.aios/kernel/patterns/ (kernel, lowest priority)
 */
export function buildContextAwareRegistry(repoPatternsDir: string): PatternRegistry {
  const cm = new ContextManager();
  const active = cm.resolveActive();
  const dirs = cm.patternDirs(active, repoPatternsDir);
  return new PatternRegistry(dirs.length > 0 ? dirs : repoPatternsDir);
}
