# ADR-0017: Dynamic workflow approvers resolved from department heads

Date: 2026-07-02

## Status

Proposed — **design only, not implemented**. Tier-3 substrate change: run the multi-lens
`review-change` workflow on the implementation plan before building (see CLAUDE.md).

## Context

M25 made `department.head` in the org template the single source of truth for reporting
lines (the employee `manager` is a derived `@DbLookup` formula field). The product intent
is stronger: *the requester's department head* should be who approves or rejects a leave
request — not any member of a static group.

The workflow engine cannot express this today. A transition gates on a single static
principal (`requiredRole: "group:managers"`) checked in shared `applyTransition` against
the session's principal set. Guards run in the sync expression lane (document-local, no
I/O, portable), and the async formula lane (`@DbColumn`/`@DbLookup`, ADR-0014) is
deliberately read-only and kept off the transition path. So today "the head approves" is a
convention (any `group:managers` member can approve), enforced only socially.

## Taxonomy

- Subsystem: Shared, Server (Client button-offering is best-effort).
- Domain Area: Definitions-as-data (workflow contract), access control, validation & expressions.
- Change Type: Architecture change.
- Risk Class: Contract / back-compat, validation parity, expression safety, ACL / readers.
- Runtime Surface: Internal API, Web UI (indirect), MCP (workflow patch tools).

## Decision (proposed)

Extend the workflow transition contract with an optional async-lane approver formula:

```jsonc
{
  "id": "approve",
  "from": "submitted",
  "to": "approved",
  "requiredRole": "group:managers",          // fallback + back-compat
  "approverFormula": "await DbLookup(doc.appId, 'employee', 'payload.person', doc.createdBy, 'payload.department') …"
}
```

- **Resolution is server-side at transition time**, in the async formula lane under the
  *requester document's* context, resolving to one or more `person:*`/`group:*` principals
  (non-principal values are dropped during normalization). For leave requests the chain
  is: `doc.createdBy` → org app employee doc → `department` slug → department doc →
  `head` (parent department's head when the requester is the head — encoded in the
  authored formula, not the engine).
- **Fallback chain — and a fail-closed floor** (review finding M1): when the formula
  resolves non-empty, the resolved principals **replace** `requiredRole` (union would let
  any role-holder approve and defeat per-head enforcement). When resolution is empty or
  fails: fall back to the static `requiredRole` if present; if the author declared
  `approverFormula` with **no** `requiredRole`, the transition is **denied** — an authored
  restriction must never degrade to no gate at all. A headless department with the
  `group:managers` fallback degrades to today's behavior instead of blocking submissions —
  this is why `department.head` stays optional.
- **`requiredRole` remains and remains checked** when no `approverFormula` is present —
  existing workflow definitions are untouched (back-compat by absence).
- **Offering rule** (review finding M2): the client cannot run async lookups, so
  `availableTransitions` treats a transition as offerable when its static role allows
  **or** an `approverFormula` is present, and the server is authoritative (`422` on a
  refused dynamic gate, with a distinct message — "requires approval by the designated
  approver" — so a role-holder refused by the dynamic gate gets an intelligible error).
  Without the or-clause, a formula-resolved approver who lacks `requiredRole` (e.g. a
  department head outside `group:managers`) could approve via the API but would never see
  the button — an unapprovable document in the UI. `availableTransitions` takes no
  resolution parameter (it filters many transitions; a flat resolved list would conflate
  them) — only `applyTransition` accepts `resolvedApprovers`.
- **Cross-app reads** reuse the ADR-0014 `DbReader` + `canReadDocument` scoping — under
  the **acting approver's** scope and always against the **local replica** (transitions
  run on each node's local Express against its local CouchDB and reconcile on sync; the
  resolver must never add a server-replica or network dependency). The gate can only
  narrow, never widen, visibility; an actor who cannot read the org data degrades to the
  `requiredRole` fallback. Deployments must therefore widen the org app's read access to
  the approver population (the airline fixture does). The formula references the org app
  by its authored id; deployments under other appIds re-point it with a designer edit.
- **Concurrency**: resolution inserts I/O between the route's document read and its write,
  widening the pre-existing read-modify-write window; the route maps a CouchDB write
  conflict to a retryable `409` instead of surfacing a 500.

## Alternatives considered

1. **Per-department apps** (`leave-flight-ops`, …) with per-app static `requiredRole` —
   works today with zero substrate change, but multiplies apps and worklists and pushes
   org structure into deployment topology.
2. **Stamping the approver on the document at submit** (effect handler writes
   `payload.approver`) — effects are best-effort and must never gate a transition, and
   `applyTransition` still cannot read per-doc principals; would need the same engine
   change anyway plus a staleness problem when heads change.
3. **Keep the convention** (`group:managers`) — no change, but the org truth and the
   enforcement stay permanently divergent.

## Consequences

- Positive: approval routing follows the org chart automatically; one workflow definition
  serves every department; the M25 airline scenario becomes the acceptance testbed
  (erin can approve frank but not dave — asserted, not assumed).
- Negative: the transition path gains an async I/O dependency (local replica read) and a
  new failure mode (formula error → falls back, logged); worklists filtered per-approver
  need more than the static `state == submitted` view.
- Neutral: validation parity is preserved by keeping the client advisory and the server
  authoritative; `applyTransition` stays pure by taking pre-resolved principals as input.

## Companion doc amendments (review finding M4/m3/m4)

Implementation must also amend the specs this design deliberately changes: the
validation-parity invariant and the `src/shared/workflow.ts` header ("client and server
can never diverge") are re-scoped to the sync lane, with server-resolved async gates
carved out as client-advisory/server-authoritative; `docs/M3/03-workflow-runtime.md` and
`docs/M3/02-data-contract.md` (engine signatures, transition shape, envelope field list)
are updated; ADR-0014's allowed-contexts list and the `formula.ts` header gain the two
new sanctioned enforcement/routing contexts, and the execution-deadline follow-up is
re-prioritized as guarding a write path; M25's acceptance bullets that assert "any
`group:managers` persona can approve/reject" are rewritten, not extended.

## Acceptance sketch (for the implementing milestone)

- Unit: gate matrix — resolved-non-empty replaces requiredRole; empty + requiredRole falls
  back; empty + no requiredRole **denies**; absent formula unchanged; actor-cannot-read-org
  yields the fallback; non-principal formula results are dropped; distinct refusal message.
- E2E (airline scenario): erin approves frank (own department head) — allowed; erin
  approving dave — 422 despite holding `group:managers`; a department head **outside**
  `group:managers` can approve their department's request (offering + gate); headless
  department falls back to `group:managers`.
- Definition validation rejects an `approverFormula` with blocked tokens or bad syntax.
