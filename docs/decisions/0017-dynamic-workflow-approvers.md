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
  *requester document's* context, resolving to one or more principals. For leave requests
  the chain is: `doc.createdBy` → org app employee doc → `department` slug → department doc
  → `head`.
- **Fallback chain, not a required field**: if the formula yields no valid principal
  (department between heads, requester without an employee record, deactivated person),
  enforcement falls back to walking up `parent` departments, then to the transition's
  static `requiredRole`. A headless department degrades to today's behavior instead of
  blocking submissions — this is why `department.head` stays optional.
- **`requiredRole` remains and remains checked** when no `approverFormula` is present —
  existing workflow definitions are untouched (back-compat by absence).
- **Client stays approximate**: the client cannot run async lookups when offering action
  buttons, so it offers by `requiredRole` and the server is authoritative (`422` on a
  refused dynamic gate). Enforcement never depends on the client.
- **Cross-app reads** reuse the ADR-0014 `DbReader` + `canReadDocument` scoping — under
  the **approver's** scope, so the gate can only narrow, never widen, visibility.
  Note the formula needs the org appId; since templates are appId-agnostic, the org app
  reference must be configuration (e.g. an `app:config` setting), not a hardcoded id.

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

## Acceptance sketch (for the implementing milestone)

- Unit: approver resolution incl. fallback chain and fail-closed formula errors.
- E2E (airline scenario): erin approves frank (own department head) — allowed; erin
  approving dave — 422; headless department falls back to `group:managers`.
- Definition validation rejects an `approverFormula` with blocked tokens or bad syntax.
