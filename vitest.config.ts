import { defineConfig } from "vitest/config";

/**
 * Default vitest config for the unit/integration test suite (`npm test`).
 *
 * Excluded from the default run:
 * - tests/e2e: spawns real CLI via tsx, run via `npm run test:e2e`
 * - *.integration.test.ts: hits real external infra (Azure DevOps, TFS, ...),
 *   run via `npm run test:integration` with the relevant env vars set.
 */
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/tests/e2e/**",
      "**/*.integration.test.ts",
    ],
  },
});
