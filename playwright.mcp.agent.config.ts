import { defineConfig } from "@playwright/test";

/**
 * Real-agent MCP acceptance config (opt-in / nightly — NOT on the PR gate).
 *
 * Boots the Lotus API (shared start-api harness + CouchDB pair) and an in-process MCP
 * HTTP host, then drives the actual `claude` CLI against it to build and maintain apps
 * and workflows from natural-language tasks. Specs self-skip when the agent driver is
 * unavailable (no binary / credentials / LOTUS_AGENT_MODEL), so this never blocks a PR.
 *
 * Run: `npm run test:mcp:agent` (requires ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN and
 * LOTUS_AGENT_MODEL in the environment). Single worker; retries absorb model stochasticity.
 */
export default defineConfig({
  testDir: "./tests/mcp/agent",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 2,
  maxFailures: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-mcp-agent" }]],
  // A full agent turn (multiple tool calls + model latency) is far slower than a scripted spec.
  timeout: 180_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: "npx tsx tests/mcp/support/start-api.ts",
    url: "http://localhost:3001/api/health",
    timeout: 120_000,
    reuseExistingServer: true
  }
});
