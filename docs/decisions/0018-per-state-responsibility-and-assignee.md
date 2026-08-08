# ADR-0018: Per-state responsibility and the engine-stamped assignee

Date: 2026-07-02

## Status

Accepted — implemented 2026-07-02 together with ADR-0017 (shared resolver, one combined
multi-lens plan review; the initial-state rule below was corrected by that review).
ADR-0017's gate was later superseded by ADR-0019; this ADR's assignee machinery is
unaffected — `responsibleFormula` is now typically just `"payload.approver"` over the
ADR-0019 stamped field. Companion to ADR-0017: same resolver, two different
moments — 0017 enforces *who may* act at gate time, 0018 tracks *who should* act while a
document sits in a state.

**Amended by ADR-0025** (2026-08-08): the engine-stamped `assignee`/`assignedAt` pair
described throughout this ADR was renamed and widened to `responsible: string[]`/
`responsibleAt` (fed by `WorkflowState.responsible`/`responsibleFormula`); the empty set is
stored field-absent, never `[]`, and `@me`/work-queue matching is now array element
membership. The freed `assignee` name is repurposed by ADR-0025 Stage 2 for a distinct
*single-individual* field. Read `responsible[]` wherever the text below says `assignee`.

## Context

The workflow engine (`src/shared/workflow.ts`) already owns a family of allocated envelope
fields on `BusinessDocument` — `state`, `stateUpdatedAt`, `stateUpdatedBy`, `history[]` —
stamped only by `applyTransition`, absent until first use so replicated documents stay
valid. But nothing marks *whose turn it is*: `requiredRole`/`approverFormula` express
permission, not assignment, and "who should act" exists only as pull-based worklist views
(`state == submitted`). M23 explicitly deferred the actor-aware `My` view filter DSL, so a
personal inbox is currently inexpressible. Every workflow app (expense, leave-request,
future templates) needs the same answer, so responsibility tracking belongs in the engine,
not in per-app payload conventions.

## Taxonomy

- Subsystem: Shared, Server, Client (display only).
- Domain Area: Definitions-as-data (workflow contract + document envelope), access control
  (adjacent), validation & expressions.
- Change Type: Architecture change.
- Risk Class: Contract / back-compat, validation parity, expression safety.
- Runtime Surface: Internal API, Web UI, MCP (workflow patch tools).

## Decision (proposed)

1. **Definition contract**: `WorkflowState` (today `{ name, label, final? }`) gains
   optional responsibility declarations:

   ```jsonc
   { "name": "submitted", "label": "Submitted",
     "responsible": "group:managers",              // static principal, or
     "responsibleFormula": "await DbLookup(…)" }   // per-document async-lane formula
   ```

   `responsibleFormula` wins when both are present; the static `responsible` is its
   fallback. Responsibility is a property of the **state** (where the document sits), not
   of a transition — that is what makes it uniform across workflows.

   **Initial-state asymmetry** (review findings, revised): documents *usually* enter the
   initial state by creation — which never stamps — but transitions **into** the initial
   state are legal and reachable (e.g. a `revise → draft` return), and those stamp like
   any other entry. So initial-state declarations are **allowed** and meaningful for
   re-entry (`responsibleFormula: "doc.createdBy"` hands a revised draft back to its
   requester); the documented asymmetry is that creation itself never stamps — a fresh
   draft's responsibility is the creator's by definition (`createdBy`/`authors`).
   Stamping at document creation was considered and rejected — it would pull workflow
   resolution into the create path for marginal value.

2. **Document envelope**: the engine's allocated family grows by one pair —
   `assignee?: string` (a `person:*`/`group:*` principal) and `assignedAt?: string`.
   Stamped **only** by `applyTransition` on state entry; cleared on entering a final state
   (nothing is owed on an approved document). `TransitionEvent` gains `assignee?: string`
   so `history[]` records each hand-off.

3. **Resolution**: the server resolves `responsibleFormula` in the ADR-0014 async lane
   (the same resolver ADR-0017 adds for `approverFormula`), under the transition actor's
   ACL scope and against the local replica, before calling the pure engine —
   `applyTransition` receives the pre-resolved value (`resolvedAssignee?: string`) and
   stays sync/portable. The resolved value passes the same normalization as approvers
   (only `person:*`/`group:*` strings survive; an array yields its first valid element) so
   a malformed formula result can never be stamped verbatim into the replicated envelope.
   Fallback chain: formula → static `responsible` → no assignee. **Assignment is routing
   metadata, not a gate: a transition never fails because responsibility resolution
   failed.** Disclosure note: the stamped `assignee` is a one-time materialization of
   data resolved under the *actor's* scope but visible thereafter to **all document
   readers** — a deliberate difference from per-request formula fields, recorded in the
   invariants rule.

4. **Consumption**: `assignee` is a stored envelope field, so — unlike formula fields —
   it works on the list path today: an "Assigned to" view column, static team worklists
   (`assignee == group:finance`), audit copies, and M8 on-change agents (e.g. escalation
   on stale `assignedAt`). A personal "assigned to me" inbox still needs the deferred
   actor-aware (`@me`) view filter — explicitly **out of scope**, future ADR.

5. **Client**: renders `assignee` read-only where it renders the state; no offering-logic
   change (that remains ADR-0017's domain).

6. **Validation**: shared `validateTransition`-equivalent checks on states —
   `responsible` must be principal-shaped; `responsibleFormula` must be non-empty, pass
   `formulaBlockedToken`, and compile (`formulaSyntaxError`). Flows to the definitions
   APIs and template registry/apply automatically. The MCP designer surface needs one
   explicit change (review finding m5): `update_state` today patches only
   `label`/`final`, so it gains a `Partial<WorkflowState>` patch (like
   `update_transition`) and the shared workflow validation enforces the new rules there
   too.

## The line this ADR holds

**Assignee is routing truth; the approver gate is enforcement truth.** The stamp can go
stale when the org chart changes mid-flight; ADR-0017's gate re-resolves at transition
time, so security is never stale even when the display is one transition behind. The two
deliberately share a resolver but are never unified — stamping-as-enforcement is the
staleness bug ADR-0017 rejected.

## Alternatives considered

1. **`assignee` in `payload`** — rejected: payload is form-owned user data; assignment is
   platform lifecycle truth and must be un-editable by forms, like `state`.
2. **Per-transition assignment** (stamp on the transition rather than declare on the
   state) — rejected: two transitions into the same state would need duplicate
   declarations, and "who owes action" is semantically a property of the state.
3. **Enforce by assignee** (gate transitions on the stamped value) — rejected: stale
   stamps become stale security; enforcement stays with ADR-0017.
4. **Keep worklist views only** — rejected: no column/audit/agent surface, no path to a
   personal inbox, and every app reinvents a convention.

## Consequences

- Positive: uniform "whose turn" across all workflows; hand-off history for free;
  team worklists and Assigned-to columns with zero new query machinery (stored field, no
  new Mango index — existing selectors filter in memory or bind existing indexes);
  escalation agents become trivially expressible.
- Negative: a second Tier-3 definition-contract change (mitigated: optional-by-absence on
  both the definition and the envelope, so no migration and no behavior change for
  existing workflows/documents); the stamp's staleness must be documented as intended.
- Neutral: implementation cost is small once ADR-0017 lands — the resolver, validation
  helpers, and test scaffolding are shared. Implement 0017 → 0018 back-to-back.

## Acceptance sketch (for the implementing milestone)

- Unit: stamp on state entry (formula, static, and none) **including a transition whose
  `to` is the initial state**, clear on final states, hand-off recorded in `history[]`,
  resolution failure stamps fallback/nothing but never fails the transition,
  non-principal formula results normalize away, validation rejects malformed
  declarations.
- E2E (airline scenario): dave submits a leave request → `assignee` is `person:carol`
  and the Departments-style worklist shows it; carol approves → `assignee` cleared;
  erin submits her own → `assignee` is `person:carol` (parent-walk via the formula).
