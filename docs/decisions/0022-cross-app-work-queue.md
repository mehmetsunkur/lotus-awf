# ADR-0022: Cross-app work queue

Date: 2026-07-22

## Status

Accepted — implemented 2026-07-22.

**Amended by ADR-0025** (2026-08-08): the work-queue's `assignee`/`assignedAt` routing
field was renamed and widened to `responsible: string[]`/`responsibleAt`; the selector
still binds `m2-readers` and the item is projected as `responsibleAt`. ADR-0025 Stage 2
moves the routing predicate in-memory as a `responsible ∪ assignee` union (selector binds
`m2-readers`+`kind` only). Read `responsible` wherever the text below says `assignee`.

**Amended by ADR-0026** (2026-10-19): per-app visibility is the app ACL level alone; the scan binds `m2-kind-docType-updatedAt` (presence predicates on `docType`/`updatedAt`) instead of `m2-readers`, with no `canReadDocument` post-filter.

## Context

Agents (the ADR-0021 operator, and future spawned workers) need to know *whether
there is anything to do* before they run. Today the only answer is per-app: an
agent authenticates to one app and `GET`s an inbox view (`view:my-sessions`,
`view:my-approvals` — ADR-0018 assignee + ADR-0020 `@me`). The operator's tick loop
polls exactly this every 15 s (ADR-0021). That does not compose: an identity that
holds work across several apps has no single question to ask, so a controller that
wants to spawn an agent *only when work exists* must either poll every app view or
let agents wake up, look around, and find nothing. The assignee envelope already
records "whose turn it is" uniformly across every workflow app; what is missing is
an **aggregate read** of it.

## Taxonomy

- Subsystem: Server (new aggregating endpoint); consumer in `src/operator`.
- Domain Area: Access control, Identity & sessions, Query & indexing, App lifecycle
  (multi-app enumeration); Workflow assignment envelope (read-only).
- Risk Class: Security (ACL/readers — cross-user *and* cross-app leak surface),
  Authentication (identity resolution), Performance (index & query).
- Runtime Surface: Internal API (Express), consumed by the operator daemon.

## Decision

1. **`GET /api/work-queue`** aggregates the ADR-0018 assignee envelope across every
   `installedApps()` database for the **authenticated caller** and returns
   `{ total, byApp: [{ appId, database, count, items? }] }`.

2. **Caller-scoped, never `?principal=`.** Identity is the session, exactly as
   `@me` resolves in ADR-0020 — the endpoint never accepts a caller-supplied
   principal. This keeps it inside the Identity and ACL invariants: answering
   "does person X have work" for a *different* authenticated caller would be a
   cross-user read of X's assigned-and-readable documents. To ask about a persona's
   queue, a controller authenticates **as** that persona via the existing
   persona-bearer mechanism (M27/M28), the same way the operator already reads under
   a persona. A privileged all-principals aggregate is a separate, admin-only
   surface with its own ACL decision — deliberately **out of scope** here.

3. **The cheap gate is one selector per app db**: `kind == "document"` and
   `assignee ∈ principals`, AND-ed with `accessSelector(scope)` and post-filtered by
   `canReadDocument` — the same ACL discipline every list route uses. It needs **no
   workflow definition and no explicit final-state filter**: `applyTransition`
   *clears* `assignee` on entry to a final state (ADR-0018), so a completed/failed
   document carries no assignee and never matches. Principal expansion
   (`principalsFor` — person + groups) makes a `group:*` assignment fan out to every
   member's queue, identically to ADR-0020.

4. **Per-app authority is checked, not assumed.** For each installed app the route
   computes `appAccessLevel(principals, db)` and **skips** apps below `reader` — never
   a 403 (this is an aggregate, not a per-app request) and never a leak of their
   contents. Skipped apps are simply absent from `byApp`.

5. **No new index.** The selector binds the existing **`m2-readers`** ACL index —
   `readers ∈ principals` is the selective predicate; `assignee`/`kind` are in-memory
   predicates on the scanned rows. This is the ADR-0020 cost class (literally the same
   index the ACL filter already relies on), so the three-site index-sync rule is
   untouched. Binding is asserted via CouchDB `_explain` in e2e. If assignee
   selectivity ever degrades at scale, the ADR-0020 escape hatch applies: a partial
   index on `assignee`.

6. **Optional refinements**: `?actionable=true` loads the workflow def per docType and
   keeps only documents with an available transition for the caller
   (`availableTransitions().length > 0`) — "work I may act on *now*", distinct from
   "work assigned to me but currently blocked". `?items=true` returns document refs
   (`_id`, `docType`, `state`, `assignedAt`) for the spawn payload; the default is
   counts only.

## Alternatives Considered

1. **`?principal=person:x` answered by a privileged caller** — rejected for v1: breaks
   the caller-supplied-principal ban (ADR-0020 §2, Identity + MCP invariants). Belongs
   in a separate admin surface if a real need appears.
2. **A per-app work-queue view (`view:my-work`) the controller fans out over** —
   rejected: it just moves the N-app fan-out to the caller and re-leaks the
   per-app-polling problem this ADR exists to retire.
3. **Event-driven spawn (emit on `applyTransition` assignee stamp; controller
   subscribes)** — the genuinely-no-polling design, and the natural follow-up. Scoped
   separately: this ADR ships the pull aggregate, which also serves as the
   reconciler/startup-sweep for any future push path.

## Consequences

- Positive: one question — "does this identity have work anywhere?" — replaces N
  per-app polls; the operator's ADR-0021 loop can gate on it. The assignee envelope
  gains a cross-app consumer with zero new storage or index.
- Negative: a new fan-out read over every installed app db per call (bounded by
  `installedApps()` count; each query is the ACL cost class).
- Neutral: caller-scoped-only means cross-persona spawn decisions depend on the
  persona-bearer mechanism (M27/M28) — no new identity surface introduced here.

## Follow-Ups

- ~~Wire the operator spawn gate to `/api/work-queue`~~ — **done** (2026-07-22): the
  ADR-0021 daemon's `tick()` now polls `workQueue({ items: true })` in place of the
  per-app `view:my-sessions`, filters its own app's requested `agent-session` refs, and
  claims the oldest. The `claim` transition remains the authoritative dedupe; the gate
  only decides whether to attempt it. (`src/operator/operator.ts`,
  `tests/e2e/agent-operator.spec.ts`.)
- Event-driven spawn on the assignee stamp (Alternative 3), with this endpoint as the
  reconciler.
- Revisit a privileged all-principals aggregate only if a concrete controller needs it.
