# 03 — Workflow Runtime

## Decision: Option A (optimistic offline transitions + reconcile)

M3 resolves vision Q-1 in favor of **Option A**: documents can advance state while offline, and sync
reconciles. The alternative (Option B, online-only transitions) was rejected because it breaks the
offline-first thesis for the one feature — workflow — that most needs it, and because M2 already
proved the prerequisite: the expression runtime evaluates identically on client and server.

## The engine is one shared module

All transition logic lives in `src/shared/workflow.ts`, a pure module imported by **both** client and
server (aspect A3). It exposes:

- `currentState(doc, def)` — `doc.state ?? def.initialState`.
- `availableTransitions(doc, def, user, roles)` — transitions whose `from` matches the current state,
  whose `guard` evaluates truthy over `{ payload, doc, user, now }`, and whose `requiredRole` (if any)
  is held by the user.
- `applyTransition(doc, def, transitionId, user, roles, now)` — `roles` are the user's `acl:rules`
  roles, used to enforce `requiredRole` (mirroring `availableTransitions`). Returns the next envelope
  (new `state`, stamped `stateUpdatedAt`/`stateUpdatedBy`, appended `history`) **or** a
  `ValidationError[]` if the transition is not currently legal.

The engine performs no I/O and mutates nothing. The same function decides "what can I do" in the UI
and "is this write legal" on the server, so client and server can never diverge.

Guards reuse `evaluateBoolean` from `src/shared/expression.ts` unchanged — the existing
`{ payload, doc, user, now }` context already exposes `doc.state`, so guards can branch on state
without touching the evaluator (its safety surface stays exactly as audited in M2).

**Caveat on `now`:** `now` is sampled from the local wall clock independently on each side (client at
render time, server at request time), so a guard that branches on `now` is *not* guaranteed to evaluate
identically across client and server — the client could offer an action the server then rejects. M3
guards must therefore not gate on `now` (the only shipped guard is `payload.amount > 0`). The
"evaluates identically" guarantee applies to guards over the replicated `{ payload, doc, user }` only;
making `now`-dependent gating deterministic (a single threaded timestamp, or server-only evaluation) is
deferred.

## What "server-authoritative" means on CouchDB

A CouchDB server does not get to reject a replicated revision — when a device syncs, the new revision
simply arrives. So authority is exercised in two complementary places:

1. **Online transitions** go through `POST /api/documents/:id/transition`. The server loads the doc,
   the `workflow:*` def, and the user's roles from `acl:rules`, runs `applyTransition`, and only then
   writes. Illegal transitions return `422` — exactly like validation does today.

2. **Offline transitions** are applied by the client via the same `applyTransition` and written
   locally. On the next sync, the new revision replicates up. A **reconcile pass** (run as part of the
   replicate flow) then:
   - detects documents with `_conflicts` whose revisions disagree on `state` — these are concurrent
     offline transitions and are surfaced through the existing conflict queue for human resolution
     (aspect A4);
   - re-checks that the winning revision's `state` was reachable; an unreachable state is reported so
     it does not pass silently.

This is deliberately **not** a CouchDB `validate_doc_update` design function. Such a function would
have to be hand-written in JavaScript inside the database and kept byte-for-byte in step with the
TypeScript engine — which would violate the "one engine, evaluated identically" guarantee (A3). Keeping
reconciliation in the server process lets it call the very same `src/shared/workflow.ts`.

## Conflict classes

M2 had one workflow-relevant conflict class: two edits to the same field. M3 adds:

- **Concurrent transition** — two devices advance the same document from the same prior state. Couch
  records both as `_conflicts`; the runtime surfaces them with their `state` shown so a human picks the
  intended outcome.

Resolution reuses the M2 conflict resolver (keep a winning revision, drop the losers). No automatic
state merge is attempted — that is correct for a lifecycle, where silently merging states is unsafe.

## Safety posture

Guards are trusted developer-authored expressions, same posture as M2. Role gating via `acl:rules` is
a usability and correctness gate, **not** a production security boundary — like the M1/M2 ACL spike, it
is not hardened against a malicious offline client editing its own replica. Production-grade,
signed/server-enforced transitions remain out of scope (see [01-scope.md](01-scope.md)).

## Non-goals

- `onEnter`/`onExit` side effects beyond the state/history stamp.
- Timers, scheduled transitions, or event-triggered automation.
- Parallel branches, sub-workflows, or join/fork semantics.
- Automatic state merge during conflict resolution.
