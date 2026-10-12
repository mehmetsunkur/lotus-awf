import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the M2 metadata runtime.
 *
 * Isolation model: each worker owns an ephemeral environment — a private CouchDB
 * pair (testcontainers) plus one Express server that serves both the built SPA
 * (dist/) and /api. This is set up in the `workerHarness` fixture
 * (tests/e2e/support/fixtures.ts), which also overrides `baseURL` per worker, so
 * specs run fully in parallel with a per-test /api/reset clean slate.
 *
 * globalSetup (tests/e2e/support/global-setup.ts) does the run-once prerequisites:
 * build dist/ and pre-pull the CouchDB image. There is no shared `webServer` or
 * fixed `baseURL` — both come from the per-worker harness.
 */

// Each worker runs ~2 CouchDB containers + a node server + Chromium (~0.6-0.8 GB).
// Cap workers to keep container RAM/disk in check and limit CPU contention (which
// stretches the runtime's refresh cascades that the settle helper waits out).
// Override with PLAYWRIGHT_WORKERS / PLAYWRIGHT_MAX_FAILURES.
const WORKERS = Number(process.env.PLAYWRIGHT_WORKERS ?? 4);
// Fail fast: stop the run once this many tests have failed (0 = run everything).
const MAX_FAILURES = Number(process.env.PLAYWRIGHT_MAX_FAILURES ?? 5);
// Browser engine: PW_BROWSER=chromium (default) | firefox — Playwright's bundled builds.
// Opt-in branded Chromium via PW_CHANNEL (e.g. chrome for the installed Google Chrome).
// Full Chrome is heavier than the headless shell, so pair it with fewer workers
// (PLAYWRIGHT_WORKERS=1-2).
const BROWSER = process.env.PW_BROWSER || "chromium";
const CHANNEL = process.env.PW_CHANNEL || undefined;
const DEVICES = { chromium: "Desktop Chrome", firefox: "Desktop Firefox" } as const;
if (!(BROWSER in DEVICES)) {
  throw new Error(`PW_BROWSER must be one of ${Object.keys(DEVICES).join(", ")}; got "${BROWSER}"`);
}
if (CHANNEL && BROWSER !== "chromium") {
  throw new Error(`PW_CHANNEL (${CHANNEL}) selects a Chromium brand; unset it or use PW_BROWSER=chromium`);
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  workers: WORKERS,
  maxFailures: MAX_FAILURES,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    // baseURL is supplied per worker by the workerHarness fixture.
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: CHANNEL ?? BROWSER,
      use: { ...devices[DEVICES[BROWSER as keyof typeof DEVICES]], channel: CHANNEL }
    }
  ]
});
