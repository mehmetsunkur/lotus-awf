# Server

## Doc Sync Metadata

- Last code review baseline: `0dba944`
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
revocation purge, conflict inspection/resolution, Mango indexes, (M3) workflow transitions + sync
reconciliation, and (M6) template export/diff/apply.

## Main Files

- `src/server/index.ts` — all HTTP endpoints (definitions, documents, views, conflicts, demos, and
  the M3 `POST /api/documents/:id/transition` + `reconcileStates` in the replicate flow).
- `src/server/couch.ts` — CouchDB client, `replicateBidirectional`/`replicateOnce`, `createIndex`, `findDocs`.
- `src/server/config.ts` — local vs server Couch URLs, app db/user.
- `src/server/seed-data.ts` — seed definitions (incl. `workflow:expense`) + sample documents.
- `src/server/handlers/effects.ts` (M7) — server-only effect registry + `runEffect` (best-effort,
  in-memory log).
- `src/server/handlers/agents.ts` (M8) — server-only agent-handler registry + `runAgentHandler`
  (fail-closed). The `runAgents()` tick orchestrator lives in `index.ts`.
- `scripts/*.ts` — `seed`, `reset`, `replicate`, `force-conflict`, `force-state-conflict`,
  `acl-spike`, and `app` (M7 definitions-as-code `extract`/`apply` CLI).

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
  on an illegal/role-gated transition. (M7) After the authoritative write, a transition's `action`
  effect runs best-effort via `runEffect`, surfaced as `effects[]`.
- Compute (M7): `POST/PUT /api/documents` apply `applyComputedFields` (shared) so computed fields are
  derived identically to the client. `GET /api/plugins/manifest` and `GET /api/plugins/log` expose
  the handler manifest and the in-memory effect log (cleared on `/api/reset`).
- Agents (M8): `POST /api/agents/run` ticks `runAgents()` — runs due scheduled agents and drains
  `changesSince(checkpoint)` for on-change agents, writing durable `agentrun:*` records and advancing
  the `agent:state` checkpoint (at-least-once, dedupe by agentId+rev, fail-closed). `GET /api/agents`
  and `GET /api/agents/runs` list definitions and run history. Server-authoritative; ticks are
  serialized in-process so overlapping calls cannot double-run or 409 the checkpoint; optional
  `AGENTS_INTERVAL_MS` loop is off by default.
- Definition save (M4/M8): `PUT /api/definitions/:id` accepts `form:*`, `view:*`, `workflow:*`, and
  `agent:*` (M8), runs shared `validateDesignDefinition`, then writes **local** Couch; invalid
  definitions return `422 definition_validation_failed`.
- Template promotion (M6/M8): `POST /api/templates/export|diff|apply` packages only design docs
  (`app:config`, `acl:rules`, `form:*`, `view:*`, `workflow:*`, `agent:*`), strips stale `_rev`,
  compares by definition id, and applies add/update changes to **local** Couch without touching
  business docs. Runtime `agentrun:*` / `agent:state` docs are NOT packaged.
- Sync: `POST /api/replicate` → scoped `replicateBidirectional` → local `_purge` of server-revoked
  docs → `reconcileStates` reports concurrent state divergence; conflicts surfaced via
  `/api/conflicts`. Resolve accepts `chosenRev` to elect the winning revision's state.

## Existing Patterns

- Endpoints are thin; CouchDB access goes through `couch.ts` helpers.
- Payload and definition validation always go via `src/shared` (never re-implemented server-side).
- Access checks go through `src/shared/access.ts`; do not inline ad hoc `readers`/`authors` logic in
  routes.
- Template normalization/diff goes through `src/shared/template.ts`.

## Invariants

See `docs/invariants.md`: **Replication & conflict**, **ACL / readers**, **Offline editing**,
**Index & query**, **Validation parity**, **Definitions-as-data contract**, **Handler / plugin
runtime**, **Agent runtime** govern this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0002-offline-first-dual-couchdb.md`
- `docs/decisions/0003-mango-index-strategy.md`
- `docs/M5/02-access-policy.md`
- `docs/M5/03-replication-purge.md`
- `docs/M6/02-template-contract.md`
- `docs/M6/03-promotion-runtime.md`

## Tests

`tests/e2e/**` (Playwright) — needs the CouchDB pair up; see `tests/e2e/README.md`.

## Common Pitfalls

- **Index triplication**: the three indexes (`m2-kind-docType-updatedAt`, `m2-readers`,
  `m3-docType-state-updatedAt`) live in `scripts/seed.ts`, `scripts/reset.ts`, AND `ensureIndexes` in
  `src/server/index.ts` — update all three together.
- Adding a server save path that bypasses shared validation.
- Letting `PUT /api/definitions/:id` accept a new definition kind without updating shared validation.
- Letting template apply write stale `_rev` values from the source artifact.
- Accidentally including `kind: "document"` business docs in template export/apply.
- A query path that ignores `readers` filtering and leaks across users/roles.
- Using normal `DELETE` for revocation cleanup; it can replicate as a global delete. Use local
  `_purge` for M5 revocation shape.
- A change that makes an offline action depend on the server replica.
- Running a transition effect before the authoritative write, or letting an effect throw into the
  route (it must be best-effort and never block/revert the transition).
- Advancing the agent checkpoint before writing runs, or letting an agent handler throw into the tick
  (runs are durable + at-least-once; the tick must be fail-closed per agent).
- Templating or returning `agentrun:*` / `agent:state` as business documents (they are runtime data).
