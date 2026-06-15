# 04 — Build Plan

## Step 1 — M3 docs and contracts

Add M3 scope, data contract, workflow runtime, build plan, and acceptance docs. Update the M2
expression-runtime non-goals (it listed "Workflow transition rules"). Exit when the milestone boundary
and the Option-A decision are explicit.

## Step 2 — Contract types

Extend `src/shared/types.ts`:

- `WorkflowDefinition` (`workflow:${docType}`), `WorkflowState`, `WorkflowTransition`, `TransitionEvent`;
- optional `state`/`stateUpdatedAt`/`stateUpdatedBy`/`history` on `BusinessDocument`;
- add `WorkflowDefinition` to the `DesignDocument` union.

Exit when types compile and missing-state back-compat is encoded as the `currentState` rule.

## Step 3 — Shared workflow engine

Add `src/shared/workflow.ts` with `currentState`, `availableTransitions`, and `applyTransition`. Pure,
no I/O, reuses `evaluateBoolean`. Exit when client and server can both import it.

## Step 4 — API transition and reconcile

Add to `src/server/index.ts`:

- `workflowForDocType()` loader;
- `POST /api/documents/:id/transition` running the shared engine authoritatively;
- a reconcile pass folded into the replicate flow surfacing state conflicts;
- `workflow:*` in the `GET /api/definitions` response.

Exit when an online transition advances state and an illegal one returns `422`.

## Step 5 — Seed and index

Extend `src/server/seed-data.ts` with `workflow:expense`, sample expense states, and
`view:pending-approvals`. Add the `m3-docType-state` index in **all three** index locations. Exit when
reset creates an M3 app database.

## Step 6 — Runtime UI

Extend `src/client/main.tsx`:

- load `workflow:*` defs;
- a `WorkflowBar` with the state badge and available transition buttons;
- a transition history panel;
- workflow state in the document table column;
- state shown on conflict revisions.

Exit when a user can advance a document through its lifecycle from the runtime.

## Step 7 — Acceptance verification

Run build and live CouchDB checks:

- reset; replicate;
- transition draft → submitted → approved online;
- confirm role gating blocks an unauthorized approve;
- force a concurrent-transition conflict and resolve it;
- confirm a state-less (M2-era) document adopts `initialState`.

Add `scripts/force-state-conflict.ts` and `tests/e2e/workflow.spec.ts`. Because M3 touches replication
reconciliation, the contract types, and index seeding, run the multi-lens review
(`.claude/workflows/review-change.js`, `mode: diff`) before the final commit. Exit with updated notes
and clean git status.
