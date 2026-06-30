import { test as base, expect } from "@playwright/test";
import { startHarness, type Harness } from "../../support/harness";

/**
 * Per-worker MCP test harness. Each Playwright worker owns an isolated, ephemeral
 * environment — a private CouchDB pair (testcontainers) plus one locally-spawned
 * Express server on a free port — exactly like the browser e2e suite, minus the
 * browser. The app runs as a real local process (debuggable, not containerized);
 * only its CouchDB dependency is containerized. There is no fixed port, so the
 * MCP suites never collide with another listener (e.g. a forwarded :3001).
 *
 * Specs read `apiBaseURL` to point their MCP host / stdio servers / resets at this
 * worker's API. `resetState` re-seeds the worker's CouchDB before each test, so
 * tests that share a worker stay independent and tests across workers are isolated.
 */

type WorkerFixtures = {
  /** This worker's isolated CouchDB pair + Express server. */
  workerHarness: Harness;
  /** This worker's Express base URL (http://localhost:<free-port>). */
  apiBaseURL: string;
};

type TestFixtures = {
  /** Auto fixture: re-seed this worker's CouchDB pair before each test. */
  resetState: void;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerHarness: [
    async ({}, use) => {
      const harness = await startHarness();
      await use(harness);
      await harness.stop();
    },
    { scope: "worker", timeout: 120_000 }
  ],
  apiBaseURL: [
    async ({ workerHarness }, use) => {
      await use(workerHarness.baseURL);
    },
    { scope: "worker" }
  ],
  resetState: [
    async ({ request, apiBaseURL }, use) => {
      const response = await request.post(`${apiBaseURL}/api/reset`);
      if (!response.ok()) {
        throw new Error(`/api/reset failed with status ${response.status()}`);
      }
      await use();
    },
    { auto: true }
  ]
});

export { expect };
