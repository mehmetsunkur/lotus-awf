# Client

## Doc Sync Metadata

- Last code review baseline: `89536b0`
- Last reviewed date: `2026-06-15`
- Code areas:
  - `src/client/**`
- Tests:
  - `tests/e2e/**`
- Config/runtime areas:
  - `vite.config.ts`
  - `index.html`
- Review trigger:
  - Update this doc when the runtime UI shell, form/view rendering, the save/transition flow, or the
    conflict resolution UI change.

## Purpose

React metadata-driven runtime UI: renders forms/views from replicated definitions, edits local
documents, hosts the M4 structured definition studio (with JSON escape hatch) and the conflict
resolution panel.

## Main Files

- `src/client/main.tsx` — the entire single-file runtime shell (status strip, view picker,
  document table/form, M4 definition studio, conflict panel, and the M3 `WorkflowBar` /
  `WorkflowHistory` and per-revision conflict resolution).
- `src/client/styles.css`.

## Key Flows

- Boot → `GET /api/status|definitions|conflicts` → render shell (`definitions` carries `workflows`,
  `user`, `roles`).
- Edit → shared `validatePayload` runs client-side → `POST/PUT /api/documents` (local replica).
- Compute (M7) → `applyComputedFields` (shared) derives `compute` fields from the live draft, offline;
  computed fields render read-only and recompute as inputs change.
- Transition (M3) → `WorkflowBar` renders `availableTransitions` (shared engine) → `POST
  /api/documents/:id/transition` → refresh.
- Authoring (M4) → structured form/view/workflow controls update the JSON definition in memory →
  shared `validateDesignDefinition` runs client-side → `PUT /api/definitions/:id` (local replica) →
  refresh.
- Conflict resolve → "Keep This Revision" on any revision → `POST /api/conflicts/:id/resolve` with
  `chosenRev` so the elected state/history survives.
- Switch view does NOT auto-refetch documents; a refresh does (see `tests/e2e/support/fixtures.ts`).

## Existing Patterns

- Validation/visibility/defaults come from `src/shared` (same code as the API).
- Definition validation comes from `src/shared/definition-validation.ts` (same code as the API).
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
