# Server

## Doc Sync Metadata

- Last code review baseline: `928f4be`
- Last reviewed date: `2026-06-14`
- Code areas:
  - `src/server/**`
  - `scripts/**`
- Tests:
  - `tests/e2e/**`
- Config/runtime areas:
  - `docker-compose.yml`
  - `.env.example`
- Review trigger:
  - Update this doc when API endpoints, replication, conflict handling, ACL, or index seeding change.

## Purpose

Express API over **two** CouchDB replicas (local `:5985`, server `:5984`). Owns definitions,
business documents, bidirectional replication, conflict inspection/resolution, and Mango indexes.

## Main Files

- `src/server/index.ts` — all HTTP endpoints (definitions, documents, views, conflicts, demos).
- `src/server/couch.ts` — CouchDB client, `replicateBidirectional`/`replicateOnce`, `createIndex`, `findDocs`.
- `src/server/config.ts` — local vs server Couch URLs, app db/user.
- `src/server/seed-data.ts` — seed definitions + sample documents.
- `scripts/*.ts` — `seed`, `reset`, `replicate`, `force-conflict`, `acl-spike` (operational CLIs).

## Key Flows

- Save: `POST/PUT /api/documents` → shared `validatePayload` → write to **local** Couch.
- List: `GET /api/views/:id/documents` → `mangoSelector(view.filters)` → `findDocs` (uses `use_index` for `updatedAt` sort).
- Sync: `POST /api/replicate` → `replicateBidirectional` → conflicts surfaced via `/api/conflicts`.

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

- **Index triplication**: the two indexes live in `scripts/seed.ts`, `scripts/reset.ts`, AND
  `seedTarget` in `src/server/index.ts` — update all three together.
- Adding a server save path that bypasses shared validation.
- A query path that ignores `readers` filtering and leaks across users/roles.
- A change that makes an offline action depend on the server replica.
