# ADR-0026: Document visibility is the app ACL; per-document Readers deferred

Date: 2026-10-19

## Status

Accepted. Supersedes the **reader half** of ADR-0024 (§2 `readers` projection, §4 "creator is
always included; readers stay an explicit allow-list", Alternative 4). ADR-0024's two-layer edit
gate (§5) and `aclRole:"author"` fields stand, tightened below. Amends ADR-0014 (cross-app reads
gate on the target app's ACL), ADR-0005/M10 (audit visibility), ADR-0020 (no `accessSelector`
precedence), ADR-0021 (transcript scoping is no longer enforced), ADR-0022/0025 (work-queue
index binding) and ADR-0003 (index set: `m2-readers` removed).

## Context

Every business document carried a non-empty `readers` allow-list: the creator's full principal
set (person **and every group they belong to**) unioned with `aclRole:"reader"` field values.
Visibility was `readers ∩ principals`, enforced by `canReadDocument`, a Mango `accessSelector`
bound to `m2-readers`, the pull-replication selector, the purge, and a hand-rolled audit filter.

That diverged from Lotus Notes, where a document with no Readers field is visible to anyone with
Reader+ in the database ACL and Readers fields are an exception for sensitive documents. In
practice the allow-list cost a lot and protected little:

- readership depended on *who created* a document (their group memberships at create time),
  not on the app design;
- six of seven templates carried an `aclReaders` field whose only job was to re-widen access
  back to (roughly) the app's ACL;
- granting app access did not expose existing documents, so the app ACL `reader` level meant
  little on its own;
- reversing to Notes semantics in place (an "all readers" sentinel) needed a narrowing
  rollup, fail-closed reader formulas, a level-aware purge and revocation redesign.

We do not currently need to hide sensitive documents from app readers.

## Taxonomy

- Subsystem: Shared, Server, MCP (contract/snapshots), Playground (fixtures).
- Domain Area: Access control, Definitions-as-data (`aclRole`), Query & indexing, Replication &
  conflict, Audit.
- Risk Class: Security (ACL leak surface redefined; new cross-app gate), Contract / back-compat
  (`readers` dropped; `aclRole:"reader"` retired), Performance (`m2-readers` removed), Data
  integrity (per-document purge removed).
- Runtime Surface: Internal API, MCP (inherited), Web UI (indirect).

## Decision

### 1. Read = app ACL level ≥ `reader`

A person may read every business document in an app iff their resolved app ACL level
(`appAccessLevel`, best of their principals' `acl:rules` entries; `group:admins` ⇒ manager) is
`reader` or above. `requireAppSession` is the single read gate for every per-app route. There is
no per-document read check and no `readers` envelope field.

### 2. Every cross-app read path gates on the TARGET app's ACL

`readers` was the only gate on ADR-0014's `@DbLookup`/`@DbColumn` lane. `makeDbReader(scope)`
now resolves `appAccessLevel(scope.principals, targetApp.database)` per target app (memoized per
evaluation) and returns no rows below `reader`. The cross-app work queue (ADR-0022) keeps its
per-app level check and skips apps below `reader`. Server-internal ticks (agent runtime, audit
CDC, state reconcile) remain server-authoritative and unscoped.

### 3. Edit stays two-layer, Layer 2 needs Author level

`canEditDocument`: Layer 1 — app Editor+ edits anything readable; Layer 2 — app **Author+** whose
principals intersect `authors`. A Reader listed in `authors` cannot edit (Notes-faithful; this
was previously possible because document PUT/DELETE only required `reader`). Document PUT,
DELETE and conflict-resolve require `author` at the route. Resolving a conflict on a design/runtime
doc (not governed by `authors`) requires `designer`, and `manager` for `acl:rules` — otherwise an
Author could elect a losing `acl:rules` revision that promotes them (a pre-existing gap closed here). `authors` keeps the creator base plus
`aclRole:"author"` computed field values (`rollupAclProjection`, now authors-only, additive).

### 4. `aclRole` is `"author"` only

`aclRole:"reader"` is rejected by definition validation. A stored legacy form carrying it is
treated as an ordinary computed field (no ACL effect) at runtime, but re-saving it is refused (422)
until the designer removes `aclRole` or the field — the error says so. There is no automatic
migration (pre-release; templates and fixtures are already clean).

### 5. Replication, purge, revocation

Pull replication scopes business documents by `kind` only. The per-document revocation purge
(`purgeUnreadableLocalDocs`) and `/api/admin/revoke-reader` are removed: there is nothing
per-document to revoke. Revocation is an app ACL change, enforced at the API gate. The shared
local replica is not a security boundary (M5 already concedes this); purging a replica on app
ACL loss is deferred with per-user replicas.

### 6. Audit and agent runs

`auditevent` and `agentrun` no longer copy `readers`. `GET /api/apps/:appId/audit` is gated by
the app ACL alone.

### 7. Indexes

`m2-readers` is removed from all three index sites. The work queue binds
`m2-kind-docType-updatedAt` with assignee/responsible as in-memory predicates. Mango binds a JSON
index only when the selector names every indexed field, so the scan selector is
`{ kind: "document", docType: { $gt: null }, updatedAt: { $gt: null } }`. Same cost class as
before (the readers predicate no longer narrows anything).

Existing databases keep an orphaned `_design/m2-readers` index (nothing recreates it, but CouchDB
still maintains it on writes). `/api/reset` and new app databases start clean; on a long-lived
database delete it once with `DELETE /<db>/_design/m2-readers?rev=<rev>`.

Measured with `npm run perf:me-filter -- --docs 10000 --runs 20` (local dev, carol) against `main`
on the same host — index bindings unchanged and latencies within run-to-run noise:

| View | main p50 / p95 | ADR-0026 p50 / p95 |
| --- | --- | --- |
| `view:my-approvals` (m3) | 578 / 720 ms | 666 / 770 ms |
| `view:pending-approval` (m3) | 55 / 97 ms | 73 / 100 ms |
| `view:my-requests` (m2-kind) | 677 / 745 ms | 573 / 807 ms |

### 8. Existing data

Stored documents, audit events and agent runs may still carry a `readers` array. Nothing reads
it. Templates and seed data are regenerated without it; there is no backfill (ADR-0024 §7
precedent, pre-release). A future Readers feature must not trust these stale arrays.

### Accepted consequence

Every document in an app is visible to every app reader, including agent-ops session transcripts
and artifacts (ADR-0021 scoped them to operators + admins), leave requests, expense claims,
triage tickets and team-scoped kb procedures. Restriction, when needed, is expressed with the app
ACL (separate apps, or omit a group from the ACL).

## Alternatives Considered

1. **Keep the allow-list, narrow the base to `person:<creator>`** — fixes the creator-group
   oddity only; templates still need re-widening fields and the app ACL still means little.
2. **Notes semantics via an "all readers" sentinel in `readers`** — faithful, but needs a
   narrowing rollup, fail-closed reader formulas, a sentinel kept out of `principalsFor`, a
   level-aware purge and revocation redesign plus a data backfill. Too much substrate for a
   feature we do not need yet.
3. **Drop `readers` now, add Notes-style Readers later (chosen)** — when Readers return, "no
   Readers field ⇒ app-wide" is exactly the state every document is in after this change, so the
   future feature is additive (restricted docs only, e.g. a partial index on `readers`).

## Consequences

- Positive: one read gate; less code (selector, purge, revoke route, reader rollup, index gone);
  app ACL grants mean what they say; cross-app formula reads finally check the target app's ACL;
  Reader-level authors can no longer edit.
- Negative: no per-document confidentiality; per-user replica purge on ACL loss deferred;
  stale `readers` arrays remain on stored documents.

## Follow-Ups

- A future "Readers fields" ADR (Notes semantics: absent ⇒ app-wide, present ⇒ restricted, Authors
  imply read) when a real confidentiality requirement appears.
- Per-user replicas and purge on app ACL loss.
