# E2E tests (Playwright)

Browser-level tests for the M2 metadata runtime UI.

## Run

```bash
npm run test:e2e          # headless
npm run test:e2e:ui       # Playwright UI mode
npm run test:e2e:report   # open the last HTML report
```

## How it works

- **`globalSetup`** (`support/global-setup.ts`) brings the CouchDB pair up via
  `docker compose up -d local-couchdb server-couchdb` and waits for both to be
  reachable (`:5985` local, `:5984` server). It does **not** seed app data.
- **`webServer`** runs `npm run test:serve` — a non-watch variant of `npm run dev`
  (see note below) — and is considered ready when `GET /api/health` returns 200.
  `/api/health` does not touch CouchDB, so server readiness and DB readiness are
  independent.
- **Per-test isolation**: the `resetState` auto fixture (`support/fixtures.ts`)
  POSTs `/api/reset` before each test, fully re-seeding both replicas. Because
  the replicas are shared, the suite runs serially (`workers: 1`).
- **`RuntimeApp`** (`support/fixtures.ts`) is a small page object over the
  `data-testid` selectors in `src/client/main.tsx`.

## Notes / gotchas

- **Non-watch server (`test:serve`)**: `npm run dev` uses `tsx watch` + Vite file
  watching, which on this host exhausts `fs.inotify.max_user_instances` and fails
  with `EMFILE`. `test:serve` runs the API without `tsx watch` and sets `E2E=1`,
  which disables Vite's watcher (see `vite.config.ts`). Watch mode isn't needed
  for tests.
- **Settling the runtime**: the boot/refresh sequence issues several requests and
  only finalizes the selected row / reloads definitions once they all apply.
  `RuntimeApp.waitForReady()` and `refresh()` gate on the completion message
  rather than a single HTTP response to avoid racing those state updates.
- **Definition JSON editor**: it's a controlled textarea; `locator.fill()` is
  unreliable on it, so `RuntimeApp.setDefinitionJson()` drives React's onChange
  via the native value setter + an `input` event.

## Not covered yet (deferred)

Offline editing and replication-conflict-generation flows need container
stop/start orchestration and are intended for a separate `@infra`-tagged suite.
