import { defineConfig } from "vitest/config";

/**
 * Default vitest config for the unit/integration test suite (`npm test`).
 *
 * E2E tests under `tests/e2e/` are excluded here because each spawns
 * the real CLI as a subprocess (~1-2s startup per command) and would
 * slow down the developer feedback loop. Run them via `npm run test:e2e`
 * which uses `vitest.config.e2e.ts`.
 */
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/tests/e2e/**",
    ],
  },
});
