import { defineConfig } from "@playwright/test";

/**
 * MCP-over-HTTP e2e config.
 *
 * Boots the Lotus API (via the shared start-api harness and CouchDB pair) and runs the
 * MCP HTTP host in-process inside the spec. Drives the host with the official MCP
 * StreamableHTTP client transport. State is reset through the API before each spec.
 */
export default defineConfig({
  testDir: "./tests/mcp/http",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-mcp-http" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: "npx tsx tests/mcp/support/start-api.ts",
    url: "http://localhost:3001/api/health",
    timeout: 120_000,
    reuseExistingServer: true
  }
});
