# 06 — Implementation Notes

## Implemented runtime behavior

M3 adds a metadata-driven document lifecycle on top of the M2 runtime:

- a replicated `workflow:expense` definition drives expense states and transitions;
- documents carry workflow state on the envelope (`state`/`stateUpdatedAt`/`stateUpdatedBy`/`history`);
- a shared engine (`src/shared/workflow.ts`) decides available transitions and applies them;
- the runtime shows a state badge, the transitions the user may perform, and a transition history;
- transitions can be performed online via the API and optimistically offline against the local replica;
- concurrent offline transitions surface as conflicts with their states shown;
- a `pending-approvals` worklist filters expenses by `state`.

The runtime stays local-first: transitions read and write local CouchDB. The server is authoritative
in two ways — it runs the same engine on the online transition endpoint, and it reconciles transitions
on sync (see below).

## Transition model (Option A)

Vision Q-1 is resolved as **Option A**: offline transitions are allowed and reconciled on sync. The
engine is one pure module imported by both client and server, so "which actions can I take" (client)
and "is this write legal" (server) are decided by identical code (`availableTransitions` /
`applyTransition`). Guards reuse the M2 evaluator unchanged over `{ payload, doc, user, now }`; the
`doc` context already exposes `state`, so no change to `src/shared/expression.ts` was needed.

A document with no `state` is treated as the workflow's `initialState`. This keeps every already-
replicated M1/M2 document valid — verified by seeding one sample expense with no state and confirming
it renders and submits as `draft`.

## Server authority on CouchDB

CouchDB cannot reject a replicated revision, so authority is split:

- `POST /api/documents/:id/transition` runs the shared engine authoritatively before writing; an
  illegal transition returns `422` (verified: approve-from-draft and an unauthorized approve both 422).
- `reconcileStates()` runs after `replicateBidirectional()` in `POST /api/replicate`. It surfaces
  documents whose conflicting revisions disagree on `state` (concurrent transitions) and flags any
  undeclared winning state, logging findings so nothing passes silently. The conflicting documents
  already appear in the existing conflict queue.

This deliberately avoids a CouchDB `validate_doc_update` design function, which would require a second
hand-maintained JavaScript copy of the engine and break the single-engine guarantee.

## Role gating

Transitions may declare a `requiredRole`. The server resolves the current user's roles from
`acl:rules` and the engine enforces the gate; `GET /api/definitions` also returns the user and roles so
the UI offers only permitted actions. As in M1/M2, this is a usability/correctness gate, **not** a
hardened security boundary — an offline client editing its own replica is not prevented from writing an
unauthorized state; the reconcile pass is where such divergence would be surfaced. Verified live: a
`role:sales` user is refused `approve` with "Approve requires role:finance".

## Contract changes

- New `WorkflowDefinition` design document (`workflow:*`), added to the `DesignDocument` union.
- `BusinessDocument` gains optional `state`, `stateUpdatedAt`, `stateUpdatedBy`, `history` — all
  optional, so older replicated documents remain valid.
- `GET /api/definitions` now returns `workflows`, `user`, and `roles`.
- New `POST /api/documents/:id/transition`.

## Index strategy

Reset/seed creates one new Mango index, `m3-docType-state` over `["docType", "state"]`, in all three
index locations (`scripts/seed.ts`, `scripts/reset.ts`, `ensureIndexes` in `src/server/index.ts`).

Note: as in M2, the `use_index` hint is passed by index name but `createIndex` lets CouchDB
auto-generate the design-doc id, so the hint does not resolve and CouchDB selects an index (or scans)
on its own. Queries return correct results; this is a pre-existing M2 quirk, not introduced by M3, and
is worth fixing wholesale in a later cleanup by setting an explicit `ddoc`.

## Verification performed

```bash
npm run build                 # tsc --noEmit + vite build, clean
npm run reset                 # seeds workflow:expense, states, pending-approvals, index
npm run force-state-conflict  # seeds a concurrent-transition conflict
npm run test:e2e              # 13 passed (includes 3 new workflow specs)
```

Live API checks (against `npm run test:serve`-style server):

- `GET /api/definitions` returns `workflow:expense`, `user:alice`, `roles:[role:finance]`;
- submit (draft→submitted) and approve (submitted→approved) advance state and append history;
- approve-from-draft returns `422`;
- a `user:bob` (`role:sales`) server instance is refused `approve` with a role message;
- `POST /api/replicate` returns a `reconcile` report listing the seeded state conflict
  (`states: [rejected, approved]`), which also appears in `GET /api/conflicts`.

## Known limitations and risks

- Role gating is not a production security boundary (offline clients can write unauthorized states;
  the reconcile pass surfaces, but does not prevent, divergence).
- Conflict resolution keeps a winning revision; no automatic state merge (correct for a lifecycle).
- The reconcile pass reports state conflicts but does not auto-resolve them.
- `onEnter`/`onExit` side effects, timers, and parallel/branching workflows are out of scope.
- The `use_index` hint does not resolve (pre-existing M2 behavior; see Index strategy).
- The `definition-editor` invalid-JSON e2e test is occasionally flaky due to the controlled-textarea
  race documented in `tests/e2e/support/fixtures.ts`; it passes in isolation and on re-run, and is
  unrelated to M3.
