# Server

## Doc Sync Metadata

- Last code review baseline: `a95b1a4`
- Last reviewed date: `2026-07-01`
- Code areas:
  - `src/server/**`
  - `scripts/**`
- Tests:
  - `tests/e2e/**`
- Config/runtime areas:
  - `docker-compose.yml`
  - `deploy/compose.yml`
  - `deploy/k8s/**`
  - `Dockerfile`
  - `.env.example`
- Review trigger:
  - Update this doc when API endpoints, replication, conflict handling, ACL, workflow transitions,
    deployment/runtime config, or index seeding change.

## Purpose

Express API over **two** CouchDB replicas (local `:5985`, server `:5984`). Owns definitions,
definition validation, business documents, ACL-scoped query/write paths, bidirectional replication,
revocation purge, conflict inspection/resolution, Mango indexes, (M3) workflow transitions + sync
reconciliation, (M6) template export/diff/apply, (M13) production static-client serving/readiness,
(M18) directory-backed session authentication, and (M21) catalog-created business app databases.

The k8s deploy adds an MCP-over-HTTP sidecar to the app pod; that host is a client of this API and is
documented in `docs/context/mcp.md` and `docs/decisions/0011-mcp-over-http.md` — it does not change
the server's own behavior.

## Main Files

- `src/server/index.ts` — all HTTP endpoints (definitions, documents, views, conflicts, demos, and
  the M3 `POST /api/documents/:id/transition` + `reconcileStates` in the replicate flow, plus
  app-scoped `/api/apps/:appId/*` runtime aliases).
- `src/server/auth.ts` — username normalization, scrypt password hashing/verification, opaque
  session token/cookie helpers, and public Person shaping.
- `src/server/couch.ts` — CouchDB client, `replicateBidirectional`/`replicateOnce`, `createIndex`,
  `findDocs`; helpers accept an explicit database for M21 app-scoped runtime paths.
- `src/server/config.ts` — local vs server Couch URLs and database names.
- `src/server/seed-data.ts` — compatibility helpers for scripts/e2e; loads the packaged Expense
  sample from the JSON template registry.
- `src/server/template-registry.ts` — filesystem-backed bundled template loader for
  `templates/expense/*`, `templates/org/*`, and `templates/leave-request/*` (M25); pure design validation lives in
  `src/shared/template-validation.ts`.
- `src/server/handlers/effects.ts` (M7) — server-only effect registry + `runEffect` (best-effort,
  in-memory log).
- `src/server/handlers/agents.ts` (M8) — server-only agent-handler registry + `runAgentHandler`
  (fail-closed). The `runAgents()` tick orchestrator lives in `index.ts`.
- `scripts/*.ts` — `seed`, `reset`, `replicate`, `force-conflict`, `force-state-conflict`,
  `acl-spike`, and `app` (M7 definitions-as-code `extract`/`apply` CLI). M25 adds
  `seed-airline.ts` (seed the Agentic Airlines scenario into a running server) and
  `deploy-seed.sh` (deploy-stack one-shot: endpoint discovery, first-run setup, seed).
- `Dockerfile` / `deploy/compose.yml` / `deploy/k8s/` — M13 deployable artifact topologies; no source
  bind mount; the image includes `templates/` for JSON-backed app installs.

## Key Flows

- Business app resolution (M21): installed app ids map to `/:appId.nsf`, database `${appId}_app`,
  and app-scoped APIs under `/api/apps/:appId/*`. (ADR-0015) The runtime is **app-scoped only**:
  `appContextFromRequest` requires an `:appId`, `resolveBusinessApp` resolves every app (incl.
  expense) via its `appinstall` record. Expense is no longer special-cased; `createDocument` takes
  an explicit `appId`; a form's `defaultReaders` supplies extra new-doc readers. (ADR-0016) Apps are
  created via `POST /api/platform/apps` — blank (`docType`/`docTypeTitle`) or from a bundled template
  (`fromTemplate`); `instantiateTemplate` re-stamps the template's docs to the chosen appId (templates
  are appId-agnostic). `platformState.availableTemplates` lists bundled templates; there is no
  `install-sample` route or `samples[]`.
- App access editor (M22): `GET/PUT /api/apps/:appId/access` requires app manager access, returns
  sanitized directory people/groups plus `acl:rules.entries`, validates active people/existing
  groups and access levels, normalizes duplicate principals, and writes the app's local `acl:rules`
  design doc without changing existing document `readers`/`authors`.
- Workflow scaffold (M23): `GET /api/apps/:appId/workflows/scaffold-options` requires designer access
  and returns sanitized directory people/groups; `POST /api/apps/:appId/workflows/scaffold` requires
  designer access, validates the doc type and approver principal, rejects existing workflow/generated
  view collisions, and writes generated workflow/worklist definitions to the app's local database.
- Create app (M21): `POST /api/platform/apps` requires manager access, validates/reserves the app id,
  rejects duplicate install/database collisions, creates local+server app databases, writes starter
  `app:config` / `acl:rules` / `audit:policy` / form / view definitions, creates the standard Mango
  indexes, and records `appinstall:<appId>` in `platform_app`.
- Direct read: `GET /api/apps/:appId/documents/:id` → `getReadableDocument` against the app's
  **local** Couch database with current principal scope; direct document routes do not depend on a
  view result set.
- Save: `POST/PUT /api/apps/:appId/documents` → shared `validatePayload` → write to the app's
  **local** Couch database. (M12/M21) The POST path stamps the document via the generic
  `createDocument(docType, …)` and overrides `appId` from the app context, so any scaffolded type/app
  is stamped correctly.
- Create type (M12): `POST /api/document-types {docType, title}` → shared `validateDocType` (422),
  reject if `form:`/`view:<docType>` exists (409) → `scaffoldDocumentType` → validate both →
  `applyDefinition` upsert each. The scaffolded form + view promote via the template artifact; no new
  Mango index (the list view binds `m2-kind-docType-updatedAt`).
- Create workflow scaffold (M23): `POST /api/workflows/scaffold {docType, approverPrincipal}` (and
  app-scoped alias) checks `form:<docType>` exists, creates `workflow:<docType>` plus
  `view:<docType>-submitted`, `view:<docType>-mine`, and `view:<docType>-all`, validates each
  definition, and writes them local-first. It does not mutate app ACL or business document
  `readers`/`authors`.
- Directory/session (M18/M19, ADR-0012): `person:*` and `group:*` live in `names_app` (the
  `names.nsf` directory); `session:*` lives in `platform_app`. `POST /api/session/login` sets the HTTP-only `lotus_session` cookie, and
  `requireSession()` resolves the request to a principal scope before protected routes run. M19 adds
  manager-only `/api/names/directory`, `/api/names/people*`, and `/api/names/groups*` APIs (ADR-0012);
  responses are sanitized and never expose password hashes/salts or session tokens.
- Formula fields (ADR-0014): `GET /api/apps/:appId/documents/:id/formulas` resolves a document's
  `type: "formula"` fields via `resolveFormulaFields` → `evaluateFormulaAsync` (the async lane). A
  per-request `DbReader` reads the LOCAL replica of the target app (`resolveBusinessApp` → `getBusinessDocs`,
  memoized) and returns all rows; the formula lane applies the single ACL filter (`canReadDocument`).
  Kept off the document/list read paths; the client fetches it only when a form has formula fields.
- Access (M5/M18): current principals come from the authenticated session (`person:<username>`,
  direct groups, plus any explicit principals) and app-level `acl:rules` entries grant
  `reader`/`author`/`editor`/`designer`/`manager`. Business reads match document `readers`, payload
  writes/deletes require `authors`, design routes require designer-level access, and sourced select
  options use the same readable-document scope.
- List: `GET /api/views/:id/documents` → `mangoSelector(view.filters)` + access selector →
  `findDocs`; on `updatedAt` sort binds `m3-docType-state-updatedAt` for state-filtered views, else
  `m2-kind-docType-updatedAt` (hints bind because `createIndex` pins `ddoc === name`).
- Search (M9): the same endpoint with `?q=` applies the shared `searchDocuments` matcher **after** the
  `canReadDocument` ACL filter (loading the view's form from local Couch), so search narrows the
  ACL-scoped set and never widens it. No new Mango index; the matcher runs in-memory over the candidates.
- Transition (M3/M5/M18): `POST /api/documents/:id/transition` → session + read-access check →
  shared `applyTransition` (required principals such as `group:finance`) → write **local** Couch;
  `403` when unreadable and `422` on an illegal/principal-gated transition. (M7) After the
  authoritative write, a transition's `action` effect runs best-effort via `runEffect`, surfaced as
  `effects[]`.
- Compute (M7): `POST/PUT /api/documents` apply `applyComputedFields` (shared) so computed fields are
  derived identically to the client. `GET /api/plugins/manifest` and `GET /api/plugins/log` expose
  the handler manifest and the in-memory effect log (cleared on `/api/reset`).
- Audit (M10): `POST /api/audit/run` ticks `runAudit()` — drains `changesSince(audit:state)`, writes
  durable `auditevent:*` for business create/update (deduped by `docId@rev`), advances the checkpoint,
  then prunes events past `audit:policy.retentionDays` via tombstone `DELETE` (replicates the prune;
  not M5 `_purge`). Deletes are recorded best-effort in the `DELETE /api/documents/:id` path. `GET
  /api/audit` is principal-scoped (events copy the source `readers`). `audit:policy` is a templated
  design doc; `auditevent`/`audit:state` are runtime data. No new Mango index.
- Agents (M8): `POST /api/agents/run` ticks `runAgents()` — runs due scheduled agents and drains
  `changesSince(checkpoint)` for on-change agents, writing durable `agentrun:*` records and advancing
  the `agent:state` checkpoint (at-least-once, dedupe by agentId+rev, fail-closed). `GET /api/agents`
  and `GET /api/agents/runs` list definitions and run history. Server-authoritative; ticks are
  serialized in-process so overlapping calls cannot double-run or 409 the checkpoint; optional
  `AGENTS_INTERVAL_MS` loop is off by default.
- Definition save (M4/M8): `PUT /api/definitions/:id` accepts `form:*`, `view:*`, `workflow:*`, and
  `agent:*` (M8), runs shared `validateDesignDefinition`, then writes **local** Couch; invalid
  definitions return `422 definition_validation_failed`.
- Template promotion (M6/M8/M10): `POST /api/templates/export|diff|apply` packages only design docs
  (`app:config`, `acl:rules`, `audit:policy`, `form:*`, `view:*`, `workflow:*`, `agent:*`), strips
  stale `_rev`, compares by definition id, and applies add/update changes to **local** Couch without
  touching business docs. Runtime `agentrun:*` / `agent:state` / `auditevent:*` / `audit:state` docs
  are NOT packaged.
- JSON templates (M17/ADR-0016): bundled templates (`templates/expense/*`, `templates/org/*`,
  `templates/leave-request/*`) are
  packaged design + demo docs. `instantiateTemplate` re-stamps them to a chosen appId when deploying via
  `POST /api/platform/apps { fromTemplate }`; `seedDocuments()` remains a dev/scripts wrapper. The
  server validates the template artifact and each design doc, rejecting runtime/business docs from
  the design set. M18 also seeds sample directory records (Alice, Bob, `group:finance`,
  `group:sales`) around the reset path. `POST /api/reset` (dev/e2e only) returns a clean
  slate: it drops every business-app database (`<appId>_app`) along with the control
  databases before re-seeding, so leftover catalog/template apps cannot 409 the next
  create-app.
- Sync: `POST /api/replicate` → scoped `replicateBidirectional` → local `_purge` of server-revoked
  docs → `reconcileStates` reports concurrent state divergence; conflicts surfaced via
  `/api/conflicts`. Resolve accepts `chosenRev` to elect the winning revision's state.
- Readiness/deploy (M13/M14): `GET /api/health` is cheap liveness; `GET /api/ready` checks CouchDB
  plus first-run setup/platform readiness. When `dist/index.html` exists, Express serves the built
  client and falls back to `index.html` for non-API routes. `deploy/compose.yml` enables
  `APP_AUTO_SETUP=1`, so a fresh artifact install creates `names_app` and `platform_app`; Expense is
  installed only through the sample installer after setup. Setup creates and logs in the admin person;
  unauthenticated app APIs return `401`; `GET /api/platform/state` always advertises `names.nsf` in
  `systemApps`. The client renders `names.nsf`, `catalog.nsf`, and `expense.nsf` through the M20
  standard NSF workspace, while `setup.nsf` is the first-run wizard only (ADR-0012). `deploy/k8s/` mirrors the deploy topology with one app `Deployment`, two
  internal CouchDB `StatefulSet`s, PVCs, ConfigMap/Secret config, and optional ingress; production
  ingress should set `TRUST_PROXY=1`, `COOKIE_SECURE=1`, and a specific `CORS_ORIGIN`. `npm run
  test:deploy` builds/runs the Compose topology and exercises setup, catalog, runtime, and design
  operations externally over HTTP.

## Existing Patterns

- Endpoints are thin; CouchDB access goes through `couch.ts` helpers.
- Payload and definition validation always go via `src/shared` (never re-implemented server-side).
- Access checks go through `src/shared/access.ts`; do not inline ad hoc `readers`/`authors` logic in
  routes.
- Template normalization/diff goes through `src/shared/template.ts`.

## Invariants

See `docs/invariants.md`: **Replication & conflict**, **ACL / readers**, **Identity & sessions**, **Offline editing**,
**Index & query**, **Validation parity**, **Definitions-as-data contract**, **Handler / plugin
runtime**, **Agent runtime**, **Search**, **Audit & retention**, **Document-type creation** govern
this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0002-offline-first-dual-couchdb.md`
- `docs/decisions/0003-mango-index-strategy.md`
- `docs/decisions/0008-deployable-docker-artifact.md`
- `docs/decisions/0010-directory-and-session-auth.md`
- `docs/decisions/0012-names-directory-split.md`
- `docs/decisions/0014-formula-language-and-agents.md`
- `docs/M5/02-access-policy.md`
- `docs/M5/03-replication-purge.md`
- `docs/M6/02-template-contract.md`
- `docs/M6/03-promotion-runtime.md`
- `docs/M17/02-template-artifacts.md`

## Tests

`tests/e2e/**` (Playwright) — needs the CouchDB pair up; see `tests/e2e/README.md`.
`tests/deploy/**` — deploy artifact gate; requires Docker API access.

## Common Pitfalls

- **Index triplication**: the three indexes (`m2-kind-docType-updatedAt`, `m2-readers`,
  `m3-docType-state-updatedAt`) live in `scripts/seed.ts`, `scripts/reset.ts`, AND `ensureIndexes` in
  `src/server/index.ts` — update all three together.
- Adding a server save path that bypasses shared validation.
- Letting `PUT /api/definitions/:id` accept a new definition kind without updating shared validation.
- Letting template apply write stale `_rev` values from the source artifact.
- Accidentally including `kind: "document"` business docs in template export/apply.
- Forgetting to copy `templates/` into the Docker image; deploy installs must not depend on a source
  checkout bind mount.
- Letting workflow scaffolding overwrite an existing `workflow:*` or generated worklist view.
- A query path that ignores `readers` filtering and leaks across people/groups.
- A protected route that forgets `requireSession()` or checks app ACL levels ad hoc.
- An app access change that mutates existing business document `readers`/`authors`; M22 edits only
  app-level `acl:rules`.
- Exposing `passwordHash`, `passwordSalt`, `passwordParams`, raw session tokens, or `session:*` docs
  through the setup directory APIs.
- Letting setup directory mutations remove or deactivate the last active admin.
- Using normal `DELETE` for revocation cleanup; it can replicate as a global delete. Use local
  `_purge` for M5 revocation shape.
- A change that makes an offline action depend on the server replica.
- Running a transition effect before the authoritative write, or letting an effect throw into the
  route (it must be best-effort and never block/revert the transition).
- Advancing the agent checkpoint before writing runs, or letting an agent handler throw into the tick
  (runs are durable + at-least-once; the tick must be fail-closed per agent).
- Templating or returning `agentrun:*` / `agent:state` as business documents (they are runtime data).
- Reintroducing source bind mounts, Vite watch, or host `npm install` assumptions into the deploy
  artifact path.
