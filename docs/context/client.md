# Client

## Doc Sync Metadata

- Last code review baseline: `928f4be`
- Last reviewed date: `2026-06-14`
- Code areas:
  - `src/client/**`
- Tests:
  - `tests/e2e/**`
- Config/runtime areas:
  - `vite.config.ts`
  - `index.html`
- Review trigger:
  - Update this doc when the runtime UI shell, form/view rendering, or save flow change.

## Purpose

React metadata-driven runtime UI: renders forms/views from replicated definitions, edits local
documents, hosts the JSON definition editor and the conflict resolution panel.

## Main Files

- `src/client/main.tsx` — the entire single-file runtime shell (status strip, view picker,
  document table/form, definition editor, conflict panel).
- `src/client/styles.css`.

## Key Flows

- Boot → `GET /api/status|definitions|conflicts` → render shell.
- Edit → shared `validatePayload` runs client-side → `POST/PUT /api/documents` (local replica).
- Switch view does NOT auto-refetch documents; a refresh does (see `tests/e2e/support/fixtures.ts`).

## Existing Patterns

- Validation/visibility/defaults come from `src/shared` (same code as the API).
- Stable selectors: elements carry `data-testid` for e2e (see `tests/e2e/`).

## Invariants

See `docs/invariants.md`: **Validation parity** and **Offline editing** govern this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0002-offline-first-dual-couchdb.md`

## Tests

`tests/e2e/**` (Playwright). The dev server must run non-watch (`npm run test:serve`) to avoid
the host `fs.inotify` `EMFILE` limit.

## Common Pitfalls

- Re-implementing validation in the component instead of using `src/shared`.
- Adding a save/option path that requires the server replica (breaks offline).
- Removing/renaming a `data-testid` relied on by e2e specs.
