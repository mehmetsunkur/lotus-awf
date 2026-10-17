import "./tests/support/load-env";
import { defineConfig } from "@playwright/test";

/**
 * MCP (stdio) e2e config.
 *
 * Each worker owns an isolated environment via the per-worker harness fixture
 * (tests/mcp/support/fixtures.ts): a private CouchDB pair (testcontainers) plus a
 * locally-spawned Express server on a free port. The spec spawns the stdio MCP
 * servers against that API. globalSetup builds dist/ and pre-pulls the CouchDB
 * image; there is no shared webServer or fixed port.
 */
export default defineConfig({
  testDir: "./tests/mcp",
  // The opt-in real-agent suite (tests/mcp/agent) has its own config
  // (playwright.mcp.agent.config.ts) and must never run under this gate suite.
  // Anchored to tests/mcp/agent: a bare "**/agent/**" glob is matched against the absolute
  // path, so it ignores every spec when the checkout itself lives under an `agent/` directory.
  testIgnore: /tests[\\/]mcp[\\/]agent[\\/]/,
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-mcp" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 }
});
