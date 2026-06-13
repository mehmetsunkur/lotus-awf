# 05 — Acceptance

## Demo scenario

M3 should demonstrate this flow:

1. Start local CouchDB, server CouchDB, and the app runtime.
2. Reset/seed the M3 expense app.
3. Open an expense in `draft` and confirm the available action is **Submit**.
4. Submit the expense → state becomes `submitted`, history records the transition.
5. Open the **Pending Approvals** view and confirm the submitted expense appears.
6. As a finance user, **Approve** → state becomes `approved`; no further actions are offered.
7. Confirm a non-finance user is not offered **Approve**/**Reject**.
8. Disconnect server CouchDB.
9. Advance a different document's state while offline; confirm it changes locally.
10. Reconnect and sync; confirm the offline transition reconciles.
11. Force a concurrent-transition conflict (two devices transition the same doc).
12. Inspect the conflict, see the differing states, and resolve it.
13. Confirm a document created before M3 (no `state`) is treated as `draft`.

## Exit criteria

M3 is complete when the project can prove:

- a replicated `workflow:*` document drives a document lifecycle;
- transitions and their guards evaluate identically on client and server;
- transitions can be applied offline and reconcile on sync;
- role-gated transitions are enforced via `acl:rules`;
- concurrent transitions surface as conflicts and are resolvable;
- a state-filtered worklist view uses a Mango index;
- documents without a `state` adopt the workflow's `initialState`;
- M1 and M2 commands and acceptance paths still work.

## Required written outcomes

The implementation should leave behind short notes covering:

- the transition model and the Option-A decision;
- how server authority works on the CouchDB substrate (reconcile, not gatekeeper);
- role gating and its non-production posture;
- concurrent-transition conflict handling;
- known limitations and risks.

## M4 readiness

After M3, the project should have enough lifecycle substrate to start M4:

- scheduled and event-triggered agents acting on state;
- `onEnter`/`onExit` side-effect actions;
- the beginnings of the low-code authoring studio over forms/views/workflows.
