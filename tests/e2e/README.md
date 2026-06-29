# E2E tests (Playwright)

Browser-level tests for the M2 metadata runtime UI, each Playwright **worker** running
in a fully isolated, ephemeral environment.

## Run

```bash
npm run test:e2e          # headless (builds dist/ first, then runs)
SKIP_BUILD=1 npm run test:e2e   # skip the client build when dist/ is fresh
PLAYWRIGHT_WORKERS=4 npm run test:e2e   # more parallelism on a beefier host
npm run test:e2e:ui       # Playwright UI mode
npm run test:e2e:report   # open the last HTML report
```

`test:e2e` runs under **`xvfb-run`** (a virtual X display) — required on a display-less
Linux host, see the rAF gotcha below. On a machine that already has a display (e.g. a dev
desktop, or no `xvfb-run` installed such as macOS), use `npm run test:e2e:nodisplay` instead.

## How it works

- **Isolation model**: each worker owns its own substrate, so the suite runs in parallel
  (`fullyParallel: true`) with a per-test clean slate. The `workerHarness` fixture
  (`support/worker-harness.ts`) starts, per worker:
  - a private testcontainers `Network` + two `couchdb:3.4` containers (network aliases
    `local-couchdb` / `server-couchdb`) on random host ports, and
  - one Express server (`tsx src/server/index.ts`, `NODE_ENV=production E2E=1`) that serves
    both the built SPA from `dist/` and `/api`, pointed at that worker's CouchDB pair.

  The server reaches CouchDB over the Docker-mapped host endpoint (resolved via
  `container.getHost()` — **not** assumed to be `localhost`), while container-to-container
  replication uses the network aliases. This maps onto `src/server/config.ts`'s split of
  `*_COUCH_URL` (API→Couch) vs `*_COUCH_REPLICATION_URL` (Couch→Couch).
- **`globalSetup`** (`support/global-setup.ts`) runs once: builds `dist/` (skip with
  `SKIP_BUILD=1`) and pre-pulls the CouchDB image so worker 1 doesn't block on the pull.
- **`baseURL`** is overridden per worker to the worker's Express URL, so `page` and
  `page.request` target the right server transparently. Specs that talk to CouchDB directly
  use the `localCouchUrl` / `serverCouchUrl` fixtures; specs that open extra user contexts
  use `apiBaseURL`.
- **Per-test isolation**: the `resetState` auto fixture POSTs `/api/reset` (re-seeds the
  worker's replicas) and logs in alice before each test.
- **`RuntimeApp`** (`support/fixtures.ts`) is a page object over the `data-testid` selectors
  in `src/client/main.tsx`.

## Notes / gotchas

- **Needs a display (`xvfb-run`)**: with Chromium running headless on a host with **no X
  display**, the compositor never produces animation frames, so `requestAnimationFrame` never
  fires (measured 0 fps). Playwright's click/`stable` actionability check is rAF-based, so
  `click()` on a quiescent page hangs until the 30s test timeout — intermittently at first,
  then reliably under parallelism (fewer incidental renders to pump a frame). Running under
  `xvfb-run` gives a virtual display, rAF returns to ~60 fps, and clicks work normally. This is
  why `npm run test:e2e` wraps the run in `xvfb-run`. Symptom to recognize: `locator.click ...
  waiting for element to be visible, enabled and stable` with the element already resolved and
  the network idle.
- **`settle()`**: navigations and view switches trigger a background refresh cascade
  (status/definitions/conflicts/documents/options/audit) that, if it lands mid-edit, resets
  the form/definition draft and wipes typed input. `RuntimeApp.settle()` waits for a
  sustained quiet window with no in-flight `/api` request (Playwright's `networkidle` is too
  eager — the cascade has sub-second gaps). The page-object helpers call it after navigation;
  raw-action designer/studio specs call `app.settle()` after a `definition-select` / route
  change before editing.
- **Worker count**: each worker ≈ 2 CouchDB containers + a node server + Chromium. The default
  is 2 workers to bound RAM and CPU contention (contention stretches the refresh cascades);
  raise `PLAYWRIGHT_WORKERS` on a larger host.
- **Definition JSON editor**: a controlled textarea where `locator.fill()` is unreliable, so
  `RuntimeApp.setDefinitionJson()` drives React's onChange via the native value setter.

## Now unblocked: the `@infra` suite

The `workerHarness` exposes `localCouch` / `serverCouch` container handles, so a future
`@infra`-tagged suite can stop/start a replica mid-test to exercise offline editing and
replication-conflict generation — previously deferred for lack of per-test container control.
