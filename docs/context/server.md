# Server

## Doc Sync Metadata

- Last code review baseline: `52270b3`
- Last reviewed date: `2026-06-15`
- Code areas:
  - `src/server/**`
  - `scripts/**`
- Tests:
  - `tests/e2e/**`
- Config/runtime areas:
  - `docker-compose.yml`
  - `.env.example`
- Review trigger:
  - Update this doc when API endpoints, replication, conflict handling, ACL, workflow transitions, or
    index seeding change.

## Purpose

Express API over **two** CouchDB replicas (local `:5985`, server `:5984`). Owns definitions,
business documents, bidirectional replication, conflict inspection/resolution, Mango indexes, and
(M3) workflow transitions + sync reconciliation.

## Main Files

- `src/server/index.ts` — all HTTP endpoints (definitions, documents, views, conflicts, demos, and
  the M3 `POST /api/documents/:id/transition` + `reconcileStates` in the replicate flow).
- `src/server/couch.ts` — CouchDB client, `replicateBidirectional`/`replicateOnce`, `createIndex`, `findDocs`.
- `src/server/config.ts` — local vs server Couch URLs, app db/user.
- `src/server/seed-data.ts` — seed definitions (incl. `workflow:expense`) + sample documents.
- `scripts/*.ts` — `seed`, `reset`, `replicate`, `force-conflict`, `force-state-conflict`, `acl-spike` (operational CLIs).

## Key Flows

- Save: `POST/PUT /api/documents` → shared `validatePayload` → write to **local** Couch.
- List: `GET /api/views/:id/documents` → `mangoSelector(view.filters)` → `findDocs` (uses `use_index` for `updatedAt` sort).
- Transition (M3): `POST /api/documents/:id/transition` → shared `applyTransition` (roles from `acl:rules`) → write **local** Couch; `422` on an illegal/role-gated transition.
- Sync: `POST /api/replicate` → `replicateBidirectional` → `reconcileStates` reports concurrent state divergence; conflicts surfaced via `/api/conflicts`. Resolve accepts `chosenRev` to elect the winning revision's state.

## Existing Patterns

- Endpoints are thin; CouchDB access goes through `couch.ts` helpers.
- Validation always via `src/shared` (never re-implemented server-side).

## Invariants

See `docs/invariants.md`: **Replication & conflict**, **ACL / readers**, **Offline editing**,
**Index & query**, **Validation parity**, **Definitions-as-data contract** govern this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0002-offline-first-dual-couchdb.md`
- `docs/decisions/0003-mango-index-strategy.md`

## Tests

`tests/e2e/**` (Playwright) — needs the CouchDB pair up; see `tests/e2e/README.md`.

## Common Pitfalls

- **Index triplication**: the three indexes (`m2-kind-docType-updatedAt`, `m2-readers`,
  `m3-docType-state-updatedAt`) live in `scripts/seed.ts`, `scripts/reset.ts`, AND `ensureIndexes` in
  `src/server/index.ts` — update all three together.
- Adding a server save path that bypasses shared validation.
- A query path that ignores `readers` filtering and leaks across users/roles.
- A change that makes an offline action depend on the server replica.
