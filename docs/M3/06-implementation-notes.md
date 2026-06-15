# 06 — Implementation Notes

## Implemented runtime behavior

M3 adds a metadata-driven document lifecycle on top of the M2 runtime:

- a replicated `workflow:expense` definition drives expense states and transitions;
- documents carry workflow state on the envelope (`state`/`stateUpdatedAt`/`stateUpdatedBy`/`history`);
- a shared engine (`src/shared/workflow.ts`) decides available transitions and applies them;
- the runtime shows a state badge, the transitions the user may perform, and a transition history;
- transitions go through one endpoint that runs the engine and writes the local replica, so they work
  offline (the local stack serves them without the remote peer);
- concurrent transitions on different replicas surface as conflicts with their states shown, and the
  human elects which revision (and its `state`/`history`) survives;
- a `pending-approvals` worklist filters expenses by `state`.

The runtime stays local-first: transitions read and write local CouchDB. The server is authoritative
in two ways — it runs the engine in the local process before every transition write, and it reconciles
transitions on sync (see below).

## Transition model (Option A)

Vision Q-1 is resolved as **Option A**: transitions are allowed offline (served by the local stack) and
reconciled on sync. The engine is one pure module: the browser uses `availableTransitions` to decide
"which actions can I take", and the local server uses `applyTransition` to decide "is this write legal"
— identical code, but the browser does not apply transitions itself (every transition is the single
`POST /api/documents/:id/transition` call). Guards reuse the M2 evaluator unchanged over `{ payload, doc, user, now }`; the
`doc` context already exposes `state`, so no change to `src/shared/expression.ts` was needed. The
`now` value is the one exception to identical client/server evaluation — it is sampled per-side, so M3
guards must not gate on `now` (see `03-workflow-runtime.md`).

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
- `POST /api/conflicts/:id/resolve` accepts an optional `chosenRev` so the human elects which
  revision's `state`/`history` survives (not just `payload`).
- New `POST /api/demo/state-conflict` seeds an approve-vs-reject conflict for inspection/testing.

## Index strategy

Reset/seed creates one new Mango index, `m3-docType-state-updatedAt` over
`["docType", "state", "updatedAt"]`, in all three index locations (`scripts/seed.ts`,
`scripts/reset.ts`, `ensureIndexes` in `src/server/index.ts`). The field order matches the state
worklist query shape (filter `docType` + `state`, sort `updatedAt`), e.g. `view:pending-approvals`.

`createIndex` now pins the design-doc id to the index name (`ddoc === name`), so `use_index` hints
resolve and bind (verified: `_find` with either hint returns no `index ... was not used` warning). The
view route binds the m3 index for state-filtered worklists (`view:pending-approvals`) and the m2 index
otherwise. This also fixes the latent M2 behavior where the auto-generated hashed `ddoc` meant no
`use_index` hint ever bound.

## Verification performed

```bash
npm run build                 # tsc --noEmit + vite build, clean
npm run reset                 # seeds workflow:expense, states, pending-approvals, index
npm run force-state-conflict  # seeds a concurrent-transition conflict
npm run test:e2e              # 16 passed (includes 6 workflow specs)
```

Live API checks (against `npm run test:serve`-style server):

- `GET /api/definitions` returns `workflow:expense`, `user:alice`, `roles:[role:finance]`;
- submit (draft→submitted) and approve (submitted→approved) advance state and append history;
- approve-from-draft returns `422`;
- a `user:bob` (`role:sales`) server instance is refused `approve` with a role message;
- `POST /api/replicate` returns a `reconcile` report listing the seeded state conflict
  (`states: [rejected, approved]`), which also appears in `GET /api/conflicts`.

The e2e suite (`tests/e2e/workflow.spec.ts`) covers the lifecycle, the `initialState` back-compat
default, the pending-approvals worklist, electing the winning state in a concurrent-transition
conflict, **role-gating refusal** (a second API instance running as `user:bob`/`role:sales` — see the
`webServer` array in `playwright.config.ts` — is refused `approve` with `422`), and the **offline
property** (a transition writes only the local replica; the server replica is unchanged until an
explicit `POST /api/replicate`).

## Known limitations and risks

- Role gating is not a production security boundary (offline clients can write unauthorized states;
  the reconcile pass surfaces, but does not prevent, divergence).
- Conflict resolution lets the human elect which revision (and its state/history) survives; there is
  no automatic state merge, which is correct for a lifecycle.
- The reconcile pass reports state conflicts but does not auto-resolve them.
- `onEnter`/`onExit` side effects, timers, and parallel/branching workflows are out of scope.
- The `definition-editor` invalid-JSON e2e test is occasionally flaky due to the controlled-textarea
  race documented in `tests/e2e/support/fixtures.ts`; it passes in isolation and on re-run, and is
  unrelated to M3.
