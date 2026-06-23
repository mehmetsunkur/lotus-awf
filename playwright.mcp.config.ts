import { defineConfig } from "@playwright/test";

/**
 * MCP e2e config.
 *
 * This suite exercises the stdio MCP server against a real Lotus API and the
 * same CouchDB pair used by browser e2e, but it does not launch Vite or a
 * browser. Tests reset state through the API before each spec.
 */
export default defineConfig({
  testDir: "./tests/mcp",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-mcp" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: "npx tsx tests/mcp/support/start-api.ts",
    url: "http://localhost:3001/api/health",
    timeout: 120_000,
    reuseExistingServer: true
  }
});
