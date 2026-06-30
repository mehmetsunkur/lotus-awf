import "./tests/support/load-env";
import { defineConfig } from "@playwright/test";

/**
 * Real-agent MCP acceptance config (opt-in / nightly — NOT on the PR gate).
 *
 * The per-worker harness fixture (tests/mcp/support/fixtures.ts) provides an isolated
 * CouchDB pair (testcontainers) + a locally-spawned Express server on a free port; the
 * spec runs the MCP HTTP host in-process against it and drives the actual `claude` CLI
 * to build and maintain apps/workflows from natural-language tasks. Specs self-skip when
 * the agent driver is unavailable (no binary / credentials / model), so this never blocks
 * a PR.
 *
 * Run: `npm run test:mcp:agent` with the per-driver LOTUS_AGENT_CLAUDE_* / LOTUS_AGENT_CODEX_*
 * vars set (see docs/context/mcp.md), typically via a gitignored `.env`. Pinned to a single
 * worker so parallel workers don't multiply live agent runs (and cost); retries absorb
 * model stochasticity.
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
  // A full agent turn is far slower than a scripted spec, and model variance can push even a
  // one-surface workflow edit past five minutes. Generous ceiling so a slow-but-working run isn't
  // killed and re-run on a paid retry.
  timeout: 600_000,
  expect: { timeout: 10_000 }
});
