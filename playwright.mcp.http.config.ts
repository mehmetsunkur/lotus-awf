import { defineConfig } from "@playwright/test";

/**
 * MCP-over-HTTP e2e config.
 *
 * Each worker owns an isolated environment via the per-worker harness fixture
 * (tests/mcp/support/fixtures.ts): a private CouchDB pair (testcontainers) plus a
 * locally-spawned Express server on a free port. The MCP HTTP host runs in-process
 * inside the spec, bound to that worker's API, and is driven with the official MCP
 * StreamableHTTP client transport. globalSetup builds dist/ and pre-pulls the
 * CouchDB image; there is no shared webServer or fixed port.
 */
export default defineConfig({
  testDir: "./tests/mcp/http",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-mcp-http" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 }
});
