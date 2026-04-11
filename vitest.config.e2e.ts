import { defineConfig } from "vitest/config";

/**
 * Vitest config for the e2e suite (`npm run test:e2e`).
 *
 * Only picks up tests under `tests/e2e/`. Each test spawns the real
 * CLI via tsx with an isolated HOME and AIOS_EMBEDDING_PROVIDER=stub
 * so the suite is hermetic and CI-friendly (no Ollama dependency).
 *
 * Higher per-test timeout because subprocess startup adds 1-2s and a
 * publish-then-read flow does 4-6 spawns.
 */
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.{test,spec,e2e}.{ts,js}", "tests/e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
