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
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.bench.ts",
        "src/cli.ts",                  // CLI entry point — interactive, tested via e2e
        "src/commands/configure.ts",   // Interactive wizard (stdin)
        "src/init/wizard.ts",          // Interactive wizard (stdin)
        "src/mcp/server.ts",           // MCP stdio server lifecycle
      ],
      thresholds: {
        // Security modules: high bar
        "src/security/**": {
          statements: 90,
          branches: 70,
          functions: 85,
          lines: 90,
        },
        // Core engine: moderate bar
        "src/core/**": {
          statements: 60,
          branches: 50,
          functions: 60,
          lines: 60,
        },
      },
    },
  },
});
