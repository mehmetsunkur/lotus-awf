# Invariants

## Doc Sync Metadata

- Last code review baseline: `TBD`
- Last reviewed date: `YYYY-MM-DD`
- Code areas:
  - `TBD`
- Tests:
  - `TBD`
- Review trigger:
  - Update this doc when a must-preserve rule is added, removed, broken, or clarified.

These are rules implementation must preserve — the authoring-time aspects of this codebase.
When an agent edits a tagged path, the invariant hook (`.claude/hooks/invariants.mjs`) surfaces
the matching rule(s). Do not skip a rule because the change "looks inert" — confirm it. A clean
pass is fine; an unconsidered one is not. The richer adversarial review prompts derived from these
rules live in `docs/review-lenses.md` (Tier-3 multi-lens review workflow).

Each rule is a single line so the hook can surface it in full; keep it that way when editing.

## Path Tagging

Tag an invariant with a nested `- Paths:` bullet of globs. Until a rule has a `Paths:` tag the
hook stays silent for it. Globs use `**` (any depth) and `*` (within a path segment).

```md
## Persistence

- Writes must go through the repository layer; no direct SQL in request handlers.
  - Paths: `src/db/**`, `src/repositories/**`
```

## Definitions-as-data contract & back-compat

- A change to a `form:*`/`view:*` definition or its TypeScript shape must preserve documents already replicated to clients — provide a default or migration, and never make an existing field newly required without one.
  - Paths: `src/shared/types.ts`, `src/shared/template.ts`, `src/server/seed-data.ts`, `src/server/index.ts`

## Validation parity (client + API)

- Validation, required, visibility, and default rules must run through `src/shared/validation.ts` on BOTH the client and the API save path — never inlined in only one, and never accepting on one tier what the other rejects.
  - Paths: `src/shared/validation.ts`, `src/server/index.ts`, `src/client/main.tsx`

## Expression runtime

- Expression evaluation must stay safe (no eval escape, host/global/prototype access, network, or unbounded loops), deterministic, and portable (identical result client and server), and must fail closed on malformed or hostile input.
  - Paths: `src/shared/expression.ts`

## Handler / plugin runtime

- A definition may reference only a manifest-declared handler of the matching kind (`compute`→pure, `action`→effect, agent `handler`→agent); pure handlers stay portable, deterministic, and fail closed (identical client and server, no I/O), and effect/agent handlers are server-only and best-effort — never blocking, reverting, or running before the authoritative write.
  - Paths: `src/shared/handlers/**`, `src/server/handlers/**`, `src/shared/definition-validation.ts`, `src/shared/validation.ts`

## Agent runtime

- Agent execution is server-authoritative and tick-driven (never on a device): runs must be durable and at-least-once with (agentId+rev) dedupe, the `agent:state` checkpoint advances only after `agentrun:*` records are written, a failing handler records a failed run without crashing the tick, and `agentrun`/`agent:state` are runtime docs — never templated, never returned as business documents.
  - Paths: `src/shared/agents.ts`, `src/server/handlers/agents.ts`, `src/server/index.ts`, `src/server/couch.ts`

## Search

- Full-text search must be a pure, deterministic, portable matcher (identical client/server/local-replica) applied only to the already ACL-scoped set, so it can narrow visibility but never widen it; searchable fields are data (`FormField.searchable`, text-ish default on) and search must not add a Mango index or a server-replica round-trip.
  - Paths: `src/shared/search.ts`, `src/server/index.ts`

## Document-type creation

- Creating a document type must scaffold a form AND a list view (a type is unreachable in the runtime without both) via the pure `src/shared/scaffold.ts`; the docType is a unique lowercase slug (reject reserved design-doc kinds and existing types), both definitions are validated by shared `validateDesignDefinition` before a local-first write, and documents are stamped by the generic `createDocument(docType, …)` so every type's `docType`/`_id` is correct — no new Mango index (the scaffolded view binds the kind+docType index).
  - Paths: `src/shared/scaffold.ts`, `src/server/index.ts`, `src/server/seed-data.ts`

## Form layout authoring

- Studio layout edits must go through the pure `src/shared/form-layout.ts` engine and keep the form normalized — `sections` non-empty and every field in exactly one section (the runtime renders by section, so an unsectioned field is invisible); removing a section reassigns its fields and the last section cannot be removed; saves go through shared `validateDesignDefinition` so edits stay back-compatible, and the studio preview reuses the runtime renderer without colliding testids.
  - Paths: `src/shared/form-layout.ts`, `src/client/main.tsx`

## Audit & retention

- Audit is server-authoritative and CDC-driven (drains `_changes` from a checkpoint, never on a device): events are durable and at-least-once with `docId@rev` dedupe, recorded only for business-document changes (the recorder must skip its own runtime kinds — no feedback loop), each `auditevent` copies the source document's `readers` and `GET /api/audit` filters by principal so visibility only narrows; retention prunes via a replicating tombstone `DELETE` (never M5 `_purge`); `audit:policy` is design data while `auditevent`/`audit:state` are runtime data, never templated.
  - Paths: `src/shared/audit.ts`, `src/server/index.ts`

## Replication & conflict

- Changes must preserve bidirectional replication and correct `_rev`/`_conflicts` handling — never drop or silently lose a revision on resolve, and never let a payload-shape change break how conflicting revisions are compared.
  - Paths: `src/server/couch.ts`, `src/server/index.ts`, `scripts/replicate.ts`, `scripts/force-conflict.ts`

## ACL / readers

- `readers`/`authors` must be set correctly on documents this code creates, no row/field/select-option may leak across people or groups, and new query paths must still honour `readers` filtering.
  - Paths: `src/shared/access.ts`, `src/server/seed-data.ts`, `src/server/index.ts`, `scripts/acl-spike.ts`, `templates/**`

## Identity & sessions

- Protected API routes must resolve the current actor from an authenticated HTTP-only session cookie, never from client-supplied principal ids or stale fixed-user config; password hashes stay on `person:*` docs in `setup_app`, session tokens are stored only as hashes in `platform_app`, public session payloads must not expose hashes/tokens, and app ACL levels must be checked through shared access helpers.
  - Paths: `src/server/auth.ts`, `src/server/index.ts`, `src/shared/access.ts`, `src/shared/types.ts`, `src/client/main.tsx`, `tests/e2e/**`, `tests/deploy/**`

## MCP agent interface

- MCP tools must be client adapters over the authenticated Express API — never direct CouchDB writers; every app-scoped tool requires explicit `appId`, may not accept caller-supplied principals, may not mutate business documents or document `readers`/`authors`, and must validate design changes before applying them.
  - Paths: `src/mcp/**`, `docs/M24/**`
- The HTTP host (`src/mcp/http-server.ts`) must bind each MCP session to its own identity resolved server-side at `initialize` from caller-supplied **credentials** (HTTP Basic username/password, or Bearer Lotus session token) — never a caller-supplied principal. One MCP session = one `LotusClient` = one identity; sessions never share a client. Unauthenticated `initialize` is rejected, and the host stays a transport adapter (no CouchDB access, no new tool authority beyond the stdio surfaces).
  - Paths: `src/mcp/http-server.ts`, `src/mcp/http-config.ts`, `docs/decisions/0011-mcp-over-http.md`

## Offline editing

- Create/edit/validate/list/option-load must work against the LOCAL CouchDB with no server round-trip; do not add a hard dependency on the server replica or network on an offline path, and source options/definitions from local data.
  - Paths: `src/client/main.tsx`, `src/server/index.ts`, `src/server/config.ts`

## Deployable artifact

- The deploy artifact must run without a source bind mount or watch process: Docker builds from `package-lock.json`, serves the built client from Express, auto-installs setup/platform control databases for deploy compose, exposes readiness that checks both CouchDB replicas and first-run platform readiness, and `npm run test:deploy` must exercise setup/catalog plus runtime/design operations through HTTP without a manual setup click.
  - Paths: `Dockerfile`, `deploy/**`, `package.json`, `src/server/index.ts`, `tests/deploy/**`

## Index & query

- A new view `sort`/`filter` field may need a Mango index, and the three indexes (`m2-kind-docType-updatedAt`, `m2-readers`, `m3-docType-state-updatedAt`) are defined in THREE places (`scripts/seed.ts`, `scripts/reset.ts`, `ensureIndexes` in `src/server/index.ts`) that must be kept in sync. `createIndex` pins `ddoc === name` so a `use_index: "<name>"` hint resolves and binds.
  - Paths: `src/server/couch.ts`, `src/server/index.ts`, `scripts/seed.ts`, `scripts/reset.ts`

## Documentation & acceptance

- A behavior or contract change must update the spec of record (`docs/M*/0X-*`) and must not leave an acceptance criterion asserting something now false (path-level drift is also surfaced by the doc-sync hook).

## Testing

- Behavior changes require tests at the appropriate level (unit for `src/shared`, e2e for runtime flows under `tests/e2e/`).
