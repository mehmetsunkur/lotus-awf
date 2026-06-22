import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the M2 metadata runtime.
 *
 * Topology under test:
 *   - Vite web server on :3000 (proxies /api -> :3001)
 *   - Express API on :3001, talking to two CouchDB instances (:5985 local, :5984 server)
 *
 * globalSetup brings the CouchDB pair up (see support/global-setup.ts). The app
 * itself is launched by `webServer` below and gated on /api/health, which does
 * not touch CouchDB, so the two are order-independent. Per-test state isolation
 * is handled by the reset fixture in support/fixtures.ts.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  // All specs share one CouchDB pair that the reset fixture wipes per test, so
  // they must run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: [
    {
      // Non-watch server: avoids tsx/vite file watchers that exhaust the host's
      // limited fs.inotify instances. See package.json "test:serve".
      command: "npm run test:serve",
      // /api/health is proxied through Vite to the Express API and does not touch
      // CouchDB, so a 200 here means both the web and API tiers are ready.
      url: "http://localhost:3000/api/health",
      timeout: 120_000,
      reuseExistingServer: true
    },
    {
      // Second API instance against the SAME local CouchDB. Specs authenticate
      // separate request contexts to exercise different users without a backdoor.
      command: "E2E=1 API_PORT=3003 npx tsx src/server/index.ts",
      url: "http://localhost:3003/api/health",
      timeout: 120_000,
      reuseExistingServer: true
    }
  ]
});
