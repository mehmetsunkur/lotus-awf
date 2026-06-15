# Server

## Doc Sync Metadata

- Last code review baseline: `df23606`
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
definition validation, business documents, ACL-scoped query/write paths, bidirectional replication,
revocation purge, conflict inspection/resolution, Mango indexes, and (M3) workflow transitions + sync
reconciliation.

## Main Files

- `src/server/index.ts` — all HTTP endpoints (definitions, documents, views, conflicts, demos, and
  the M3 `POST /api/documents/:id/transition` + `reconcileStates` in the replicate flow).
- `src/server/couch.ts` — CouchDB client, `replicateBidirectional`/`replicateOnce`, `createIndex`, `findDocs`.
- `src/server/config.ts` — local vs server Couch URLs, app db/user.
- `src/server/seed-data.ts` — seed definitions (incl. `workflow:expense`) + sample documents.
- `scripts/*.ts` — `seed`, `reset`, `replicate`, `force-conflict`, `force-state-conflict`, `acl-spike` (operational CLIs).

## Key Flows

- Save: `POST/PUT /api/documents` → shared `validatePayload` → write to **local** Couch.
- Access (M5): current `{ user, roles }` comes from `config.appUser` + `acl:rules`; business reads
  match document `readers`, payload writes/deletes require `authors`, and sourced select options use
  the same readable-document scope.
- List: `GET /api/views/:id/documents` → `mangoSelector(view.filters)` + access selector →
  `findDocs`; on `updatedAt` sort binds `m3-docType-state-updatedAt` for state-filtered views, else
  `m2-kind-docType-updatedAt` (hints bind because `createIndex` pins `ddoc === name`).
- Transition (M3/M5): `POST /api/documents/:id/transition` → read-access check → shared
  `applyTransition` (roles from `acl:rules`) → write **local** Couch; `403` when unreadable and `422`
  on an illegal/role-gated transition.
- Definition save (M4): `PUT /api/definitions/:id` accepts `form:*`, `view:*`, and `workflow:*`,
  runs shared `validateDesignDefinition`, then writes **local** Couch; invalid definitions return
  `422 definition_validation_failed`.
- Sync: `POST /api/replicate` → scoped `replicateBidirectional` → local `_purge` of server-revoked
  docs → `reconcileStates` reports concurrent state divergence; conflicts surfaced via
  `/api/conflicts`. Resolve accepts `chosenRev` to elect the winning revision's state.

## Existing Patterns

- Endpoints are thin; CouchDB access goes through `couch.ts` helpers.
- Payload and definition validation always go via `src/shared` (never re-implemented server-side).
- Access checks go through `src/shared/access.ts`; do not inline ad hoc `readers`/`authors` logic in
  routes.

## Invariants

See `docs/invariants.md`: **Replication & conflict**, **ACL / readers**, **Offline editing**,
**Index & query**, **Validation parity**, **Definitions-as-data contract** govern this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0002-offline-first-dual-couchdb.md`
- `docs/decisions/0003-mango-index-strategy.md`
- `docs/M5/02-access-policy.md`
- `docs/M5/03-replication-purge.md`

## Tests

`tests/e2e/**` (Playwright) — needs the CouchDB pair up; see `tests/e2e/README.md`.

## Common Pitfalls

- **Index triplication**: the three indexes (`m2-kind-docType-updatedAt`, `m2-readers`,
  `m3-docType-state-updatedAt`) live in `scripts/seed.ts`, `scripts/reset.ts`, AND `ensureIndexes` in
  `src/server/index.ts` — update all three together.
- Adding a server save path that bypasses shared validation.
- Letting `PUT /api/definitions/:id` accept a new definition kind without updating shared validation.
- A query path that ignores `readers` filtering and leaks across users/roles.
- Using normal `DELETE` for revocation cleanup; it can replicate as a global delete. Use local
  `_purge` for M5 revocation shape.
- A change that makes an offline action depend on the server replica.
