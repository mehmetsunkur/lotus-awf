import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { GenericContainer, Wait } from "testcontainers";

const COUCH_IMAGE = "couchdb:3.4";

/**
 * Run-once setup for the isolated e2e harness. Per-worker substrate (CouchDB pair
 * + Express server) is created lazily in the `workerHarness` fixture; here we only
 * do the expensive shared prerequisites so the first worker's fixture doesn't eat
 * them inside its timeout:
 *
 *   1. Build the client into `dist/` — the Express server serves the SPA from
 *      there (src/server/index.ts), so without it `page.goto` hits the API 404
 *      fallback instead of the app. Skip with SKIP_BUILD=1 when `dist/` is fresh.
 *   2. Pre-pull the CouchDB image so worker 1 doesn't block on a multi-minute pull.
 */
export default async function globalSetup(): Promise<void> {
  ensureClientBuild();
  await prePullCouch();
}

function ensureClientBuild(): void {
  const distIndex = path.resolve(process.cwd(), "dist", "index.html");
  if (process.env.SKIP_BUILD === "1" && existsSync(distIndex)) {
    return;
  }
  execFileSync("npm", ["run", "build"], { stdio: "inherit" });
}

async function prePullCouch(): Promise<void> {
  // Starting and immediately stopping a throwaway container warms the local image
  // cache so worker 1 doesn't block on a multi-minute pull inside its fixture
  // timeout. This is a best-effort optimization — the image is cached as soon as
  // it's pulled, so swallow lifecycle errors and let the worker fixture proceed.
  try {
    const container = await new GenericContainer(COUCH_IMAGE)
      .withEnvironment({ COUCHDB_USER: "admin", COUCHDB_PASSWORD: "password", COUCHDB_SINGLE_NODE: "true" })
      .withExposedPorts(5984)
      .withWaitStrategy(Wait.forHttp("/_up", 5984).forStatusCode(200))
      .start();
    await container.stop().catch(() => {});
  } catch {
    // Image is pulled even if the throwaway container fails to start/stop cleanly.
  }
}
