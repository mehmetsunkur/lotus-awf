# Server

## Doc Sync Metadata

- Last code review baseline: `8455f5a`
- Last reviewed date: `2026-10-17`
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
  - `.github/workflows/image.yml`
- Review trigger:
  - Update this doc when API endpoints, replication, conflict handling, ACL, workflow transitions,
    deployment/runtime config, or index seeding change.

## Purpose

Express API over **two** CouchDB replicas (local `:5985`, server `:5984`). Owns definitions,
definition validation, business documents, app-ACL-gated query/write paths, bidirectional replication,
conflict inspection/resolution, Mango indexes, (M3) workflow transitions + sync
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
  `templates/expense/*`, `templates/org/*`, `templates/leave-request/*` (M25), the M27
  digital-twin pair `templates/kb/*` (handbook articles + authorship-scoped team procedures) and
  `templates/turnaround/*` (multi-department flight workflow), and M28's
  `templates/agent-ops/*` (ADR-0021 agent sessions: draft → submit → requested → claim →
  running → completed/failed, operator `@me` queue, artifact child docs; the session form
  deliberately has NO prompt field and no operator-stamped payload — outcome facts live in an
  operator-authored `outcome.json` artifact because `canEditDocument` (ADR-0024 two-layer:
  Editor+ ACL bypass OR an Authors-field intersection) does not grant the operator edit on the
  session doc); pure
  design validation lives in `src/shared/template-validation.ts`.
- `src/server/handlers/effects.ts` (M7) — server-only effect registry + `runEffect` (best-effort,
  in-memory log).
- `src/server/handlers/agents.ts` (M8) — server-only agent-handler registry + `runAgentHandler`
  (fail-closed). The `runAgents()` tick orchestrator lives in `index.ts`.
- `scripts/*.ts` — `seed`, `reset`, `replicate`, `force-conflict`, `force-state-conflict`,
  and `app` (M7 definitions-as-code `extract`/`apply` CLI). M25 adds
  `seed-airline.ts` (seed the Agentic Airlines scenario into a running server) and
  `deploy-seed.sh` (deploy-stack one-shot: endpoint discovery, first-run setup, seed);
  `perf-me-filter.ts` is the ADR-0020 `@me` view-filter performance harness
  (`npm run perf:me-filter`, see `docs/testing-guide.md`). M27 adds `explore-twin.ts`
  (`npm run explore:twin`): boots the isolated testcontainers harness, seeds the
  digital-twin world, and stays up for manual exploring — no compose stack or fixed
  ports needed. M29 adds `playground.ts` (`npm run playground -- field-services`):
  boots the same isolated harness, seeds a company testbed, starts MCP HTTP, optionally
  adds sidecar containers, and can spawn persona-scoped real-agent shifts.
- `Dockerfile` / `deploy/compose.yml` / `deploy/k8s/` — M13 deployable artifact topologies; no source
  bind mount; the image includes `templates/` for JSON-backed app installs.

## Key Flows

- Business app resolution (M21): installed app ids map to `/:appId.nsf`, database `${appId}_app`,
  and app-scoped APIs under `/api/apps/:appId/*`. (ADR-0015) The runtime is **app-scoped only**:
  `appContextFromRequest` requires an `:appId`, `resolveBusinessApp` resolves every app (incl.
  expense) via its `appinstall` record. Expense is no longer special-cased; `createDocument` takes
  an explicit `appId`; new-doc authors are the creator, with extra authors supplied by the form's
`aclRole:"author"` fields projected via `rollupAclProjection` in `stampComputedFields` (ADR-0024).
Documents carry no `readers` — visibility is the app ACL (ADR-0026). (ADR-0016) Apps are
  created via `POST /api/platform/apps` — blank (`docType`/`docTypeTitle`) or from a bundled template
  (`fromTemplate`); `instantiateTemplate` re-stamps the template's docs to the chosen appId (templates
  are appId-agnostic). `platformState.availableTemplates` lists bundled templates; there is no
  `install-sample` route or `samples[]`.
- App access editor (M22): `GET/PUT /api/apps/:appId/access` requires app manager access, returns
  sanitized directory people/groups plus `acl:rules.entries`, validates active people/existing
  groups and access levels, normalizes duplicate principals, and writes the app's local `acl:rules`
  design doc without changing existing document `authors`. Granting app access exposes every
  document in the app (ADR-0026).
- Workflow scaffold (M23): `GET /api/apps/:appId/workflows/scaffold-options` requires designer access
  and returns sanitized directory people/groups; `POST /api/apps/:appId/workflows/scaffold` requires
  designer access, validates the doc type and approver principal, rejects existing workflow/generated
  view collisions, and writes generated workflow/worklist definitions to the app's local database.
- Create app (M21): `POST /api/platform/apps` requires manager access, validates/reserves the app id,
  rejects duplicate install/database collisions, creates local+server app databases, writes starter
  `app:config` / `acl:rules` / `audit:policy` / form / view definitions, creates the standard Mango
  indexes, and records `appinstall:<appId>` in `platform_app`. ADR-0023: `appInstallRecord` mirrors
  the built `app:config.description` onto `AppInstall.description` at install time so
  `lotus_admin_list_apps` can show each app's purpose from `platform_app` alone; `app:config` stays
  authoritative and a later designer edit is not re-mirrored.
- Direct read: `GET /api/apps/:appId/documents/:id` → `getReadableDocument` against the app's
  **local** Couch database with current principal scope; direct document routes do not depend on a
  view result set. ADR-0023 Phase 2: `?include=transitions` wraps the response as
  `{ document, availableTransitions }` (bare document unchanged without the flag). The affordance
  block is computed via the shared `transitionAffordances`/`availableTransitions` (sync parity lane)
  under the actor's scope — each entry carries `id`/`label`/`to`, the transition `description`, and
  best-effort guard-field `helpText` — so a surfaced action is exactly one the transition endpoint
  would authorize (offering == enforcement).
- Save: `POST/PUT /api/apps/:appId/documents` → shared `validatePayload` (user-editable fields) →
  **`stampComputedFields`** (ADR-0019: computed/computed-once resolution under the writer's scope
  with preserve-on-empty and tamper-discard; also runs on the conflict-resolve route's elected
  payload) → write to the app's **local** Couch database. (M12/M21) The POST path stamps the document via the generic
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
  `authors`.
- Directory/session (M18/M19, ADR-0012): `person:*` and `group:*` live in `names_app` (the
  `names.nsf` directory); `session:*` lives in `platform_app`. `POST /api/session/login` sets the HTTP-only `lotus_session` cookie, and
  `requireSession()` resolves the request to a principal scope before protected routes run. `GET
  /api/names/directory` is readable by any active authenticated person; `/api/names/people*` and
  `/api/names/groups*` mutations remain manager-only. Responses are sanitized and never expose
  password hashes/salts or session tokens.
- Formula fields (ADR-0014): `GET /api/apps/:appId/documents/:id/formulas` resolves a document's
  `type: "formula"` fields via `resolveFormulaFields` → `evaluateFormulaAsync` (the async lane). A
  per-request `DbReader` reads the LOCAL replica of the target app (`resolveBusinessApp` → `getBusinessDocs`,
  memoized) and is the ACL boundary: it resolves the caller's level on the TARGET app and returns no
  rows below `reader`, otherwise all rows (ADR-0026).
  Kept off the document/list read paths; the client fetches it only when a form has formula fields.
- Access (M5/M18): current principals come from the authenticated session (`person:<username>`,
  direct groups, plus any explicit principals) and app-level `acl:rules` entries grant
  `reader`/`author`/`editor`/`designer`/`manager`. Business reads require app `reader` (every
  document in the app; ADR-0026 — no per-document readers), payload writes/deletes require app
  `author` plus Layer 2 `authors` (or Editor+), design routes require designer-level access, and
  sourced select options list every document of the source docType.
- List: `GET /api/views/:id/documents` → shared `mangoSelector(view.filters, docType,
  principals)` (ADR-0020: the `@me` sentinel substitutes THIS caller's principal set;
  fail-closed on empty scope) + `kind: "document"` re-asserted last (ADR-0026) →
  `findDocs`; on `updatedAt` sort binds `m3-docType-state-updatedAt` for state-filtered views, else
  `m2-kind-docType-updatedAt` (hints bind because `createIndex` pins `ddoc === name`).
- Search (M9): the same endpoint with `?q=` applies the shared `searchDocuments` matcher over the
  view's result set (loading the view's form from local Couch), so search narrows the view and never
  widens it; the app ACL gate runs first. No new Mango index; the matcher runs in-memory over the candidates.
- Transition (M3/M5/M18, ADR-0018/0019/0025): `POST /api/documents/:id/transition` → session +
  read-access check → resolve the target state's `responsibleFormula` AND `assigneeFormula` in the
  async lane (actor's ACL scope, local replica, fail-closed; routing never gates) → shared
  `applyTransition` (gating is sync-lane `requiredRole` + guards, guards receiving the actor's
  `principals`; both `responsible: string[]` and the scalar `assignee` clear-then-stamped for the
  target state) → write **local** Couch; `403` when unreadable, `422` on an illegal/refused
  transition (including a `requireAssignee` state whose `assigneeFormula` resolves empty), `409` on
  a concurrent-write conflict. Pickup ("claim") is an ordinary transition, not a new op. (M7) After the
  authoritative write, a transition's `action` effect runs best-effort via `runEffect`, surfaced as
  `effects[]`.
- Accessible apps: `GET /api/apps` → `requireSession` (platform-level) → `installedApps()` → per-app `appAccessLevel` → filter below `reader` (no 403, no leak) → `AccessibleApp[]` (`appId`, `title`, `description?`, `accessLevel`). No Mango index — pure in-memory filter over the `appinstall:*` catalog. Same ACL pattern as the work-queue skip guard.
- Work queue (ADR-0022/0025): `GET /api/work-queue` aggregates the routing pair (pool `responsible`
  ∪ individual `assignee`) across every `installedApps()` database for the **authenticated caller**
  (never a `?principal=` — same caller-scoping as ADR-0020 `@me`) → `{ total, byApp: [{ appId,
  database, count, items? }] }`. Per app: skip below-`reader` access (no 403, no leak), then one
  `findDocs` selector bound to **`m2-kind-docType-updatedAt`** (`kind` plus `$gt: null` presence
  predicates — NEITHER routing field appears in the Mango selector), **paged to exhaustion via the
  CouchDB `_find` bookmark** (a fixed `limit` would silently truncate: final-state docs stay in the
  scan and consume the budget, so live routed work past the cap would vanish), with the union `responsible ∋ principal OR assignee ∈
  principals` applied as an **in-memory** predicate over the full scan (a row matching both arms is returned once;
  items carry both `responsibleAt` and `assignedAt`; final states clear both, so completed work never
  matches). `?actionable=true` keeps only docs with an available transition
  (`availableTransitions`); `?items=true` returns doc refs for a spawn payload. Motivating consumer: the
  ADR-0021 operator, so a controller spawns agents on demand instead of polling per-app inbox views.
- Compute (M7): `POST/PUT /api/documents` apply `applyComputedFields` (shared) so computed fields are
  derived identically to the client. `GET /api/plugins/manifest` and `GET /api/plugins/log` expose
  the handler manifest and the in-memory effect log (cleared on `/api/reset`).
- Audit (M10): `POST /api/audit/run` ticks `runAudit()` — drains `changesSince(audit:state)`, writes
  durable `auditevent:*` for business create/update (deduped by `docId@rev`), advances the checkpoint,
  then prunes events past `audit:policy.retentionDays` via tombstone `DELETE` (replicates the prune;
  not M5 `_purge`). Deletes are recorded best-effort in the `DELETE /api/documents/:id` path. `GET
  /api/audit` is gated by the app ACL (events carry no `readers`; ADR-0026). `audit:policy` is a templated
  design doc; `auditevent`/`audit:state` are runtime data. No new Mango index.
- Agents (M8): `POST /api/agents/run` ticks `runAgents()` — runs due scheduled agents and drains
  `changesSince(checkpoint)` for on-change agents, writing durable `agentrun:*` records and advancing
  the `agent:state` checkpoint (at-least-once, dedupe by agentId+rev, fail-closed). `GET /api/agents`
  and `GET /api/agents/runs` list definitions and run history. Server-authoritative; ticks are
  serialized in-process so overlapping calls cannot double-run or 409 the checkpoint; optional
  `AGENTS_INTERVAL_MS` loop is off by default.
- Definition read (M7, ADR-0023 Phase 2): `GET /api/apps/:appId/definitions` returns every
  definition in full (consumed by the client editor and `lotus_designer_get_app_definitions`) — left
  untouched. Phase 2 adds progressive-disclosure reads for operator agents, all app-ACL-scoped via
  `requireAppSession`: `GET /definitions/summary` (lean self-describing index — ids + kinds + titles
  + descriptions, no bodies), `GET /definitions/forms/:docType` and `/definitions/workflows/:docType`
  (one full definition, keyed by docType), and `GET /definitions/views/:id` (one full view, keyed by
  the full `view:*` id since views are N-per-docType; non-`view:` id → 400). Missing → 404.
- Definition save (M4/M8): `PUT /api/definitions/:id` accepts `form:*`, `view:*`, `workflow:*`, and
  `agent:*` (M8), runs shared `validateDesignDefinition`, then writes **local** Couch; invalid
  definitions return `422 definition_validation_failed`.
- Template promotion (M6/M8/M10): `POST /api/templates/export|diff|apply` packages only design docs
  (`app:config`, `acl:rules`, `audit:policy`, `form:*`, `view:*`, `workflow:*`, `agent:*`), strips
  stale `_rev`, compares by definition id, and applies add/update changes to **local** Couch without
  touching business docs. Runtime `agentrun:*` / `agent:state` / `auditevent:*` / `audit:state` docs
  are NOT packaged.
- JSON templates (M17/ADR-0016): bundled templates (`templates/expense/*`, `templates/org/*`,
  `templates/leave-request/*`, and — M27 — `templates/kb/*` and `templates/turnaround/*`) are
  packaged design + demo docs. The M27 pair backs the digital-twin tier: `kb` holds team
  procedures authored by a department member (visible to every kb member — ADR-0026) with a
  `form:article`/`form:procedure` split, and `turnaround` chains a 4-hop cross-department workflow
  (`workflow:flight`: planned → scheduled → crew-assigned → ramp-checked → fueled →
  dispatched/grounded) whose per-hop authority is guard-gated on ADR-0019 computed heads
  (`opsHead`/`groundHead`, org-chart DbLookups) with ADR-0020 `@me` queue views; the org
  template's `form:employee` gained an optional `jobDescription` field (back-compatible, no
  migration). `instantiateTemplate` re-stamps them to a chosen appId when deploying via
  `POST /api/platform/apps { fromTemplate }`; `seedDocuments()` remains a dev/scripts wrapper. The
  server validates the template artifact and each design doc, rejecting runtime/business docs from
  the design set. M18 also seeds sample directory records (Alice, Bob, `group:finance`,
  `group:sales`) around the reset path. `POST /api/reset` (dev/e2e only) returns a clean
  slate: it drops every business-app database (`<appId>_app`) along with the control
  databases before re-seeding, so leftover catalog/template apps cannot 409 the next
  create-app.
- Conflict resolve (`POST /api/apps/:appId/conflicts/:id/resolve`) requires app `author`; a business
  document additionally needs `canEditDocument`, a design/runtime doc needs `designer`, and
  `acl:rules` needs `manager` (ADR-0026).
- Sync: `POST /api/replicate` (app `reader`) → `replicateBidirectional(userSync)` (push all; pull
  design kinds + business documents by `kind`) → `reconcileStates` reports concurrent state
  divergence. There is no per-document purge and no revoke-reader route (ADR-0026) — revocation
  is an app ACL change enforced at the API gate; conflicts surfaced via
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
  operations externally over HTTP; it probes the published host port and the app container IP until
  one answers (rootless dind exposes only the host port). `LOTUS_IMAGE` names the compose app image
  and `DEPLOY_SKIP_BUILD=1` gates a prebuilt image instead of rebuilding.
- Image CI (`.github/workflows/image.yml`): each arch builds natively on the self-hosted
  `[self-hosted, Linux, X64|ARM64]` runners (rootless dind, so plain `docker build`, no BuildKit
  container driver), runs `test:deploy` against that exact image, pushes
  `cr.lan.sunkur.net/lotus-notes/platform:<sha7>-<arch>`, then `imagetools create` publishes the
  multi-arch `:<sha7>` (+ `:latest` on `main`, `:<tag>` on `v*` tags). PRs build and gate only.
  `deploy/k8s/app.yaml` pins an immutable registry tag; bump it with `make k8s-set-image
  IMAGE_TAG=<sha7>`. `make image-push` pushes a single-arch SHA tag only, never `:latest`.

## Existing Patterns

- Endpoints are thin; CouchDB access goes through `couch.ts` helpers.
- Payload and definition validation always go via `src/shared` (never re-implemented server-side).
- Access checks go through `requireAppSession` and `src/shared/access.ts`; do not inline ad hoc
  `authors` logic in routes, and do not reintroduce per-document `readers` (ADR-0026).
- Template normalization/diff goes through `src/shared/template.ts`.

## Invariants

See `docs/invariants.md`: **Replication & conflict**, **ACL**, **Identity & sessions**, **Offline editing**,
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
- `docs/decisions/0023-self-describing-schema-and-scoped-reads.md`
- `docs/decisions/0026-app-acl-document-visibility.md`
- `docs/M5/02-access-policy.md`
- `docs/M5/03-replication-purge.md`
- `docs/M6/02-template-contract.md`
- `docs/M6/03-promotion-runtime.md`
- `docs/M17/02-template-artifacts.md`

## Tests

`tests/e2e/**` (Playwright) — needs the CouchDB pair up; see `tests/e2e/README.md`.
`tests/deploy/**` — deploy artifact gate; requires Docker API access.

## Common Pitfalls

- **Index triplication**: the indexes (`m2-kind-docType-updatedAt`, `m3-docType-state-updatedAt`;
  `m2-readers` was removed by ADR-0026) live in `scripts/seed.ts`, `scripts/reset.ts`, AND `ensureIndexes` in
  `src/server/index.ts` — update all three together.
- Adding a server save path that bypasses shared validation.
- Letting `PUT /api/definitions/:id` accept a new definition kind without updating shared validation.
- Letting template apply write stale `_rev` values from the source artifact.
- Accidentally including `kind: "document"` business docs in template export/apply.
- Forgetting to copy `templates/` into the Docker image; deploy installs must not depend on a source
  checkout bind mount.
- Letting workflow scaffolding overwrite an existing `workflow:*` or generated worklist view.
- A read path (incl. a cross-app lookup or aggregate) that skips the app ACL check on the TARGET app.
- A protected route that forgets `requireSession()` or checks app ACL levels ad hoc.
- An app access change that mutates existing business document `authors`; M22 edits only
  app-level `acl:rules`.
- Exposing `passwordHash`, `passwordSalt`, `passwordParams`, raw session tokens, or `session:*` docs
  through the setup directory APIs.
- Letting setup directory mutations remove or deactivate the last active admin.
- Using normal `DELETE` for replica cleanup; it can replicate as a global delete. (The M5
  per-document revocation purge was removed by ADR-0026.)
- A change that makes an offline action depend on the server replica.
- Running a transition effect before the authoritative write, or letting an effect throw into the
  route (it must be best-effort and never block/revert the transition).
- Advancing the agent checkpoint before writing runs, or letting an agent handler throw into the tick
  (runs are durable + at-least-once; the tick must be fail-closed per agent).
- Templating or returning `agentrun:*` / `agent:state` as business documents (they are runtime data).
- Reintroducing source bind mounts, Vite watch, or host `npm install` assumptions into the deploy
  artifact path.
