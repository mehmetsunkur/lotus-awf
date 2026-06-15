# 01 — Scope

## M3 objective

M3 establishes a metadata-driven workflow engine on top of the M2 runtime.

The milestone is successful when a user can advance a document through a replicated lifecycle —
including while offline — with guards and role gating enforced identically on client and server, and
with concurrent offline transitions surfaced as conflicts instead of silently overwriting state.

## Q-1 resolved: Option A (optimistic offline + reconcile)

The vision left open whether offline transitions are allowed (Option A) or transitions must be online
(Option B). **M3 chooses Option A.** M2 proved the expression runtime evaluates identically on client
and server, which is the evidence Option A needed.

Practically, on the CouchDB substrate "server-authoritative" cannot mean an online gatekeeper that
rejects a write — a replicated revision simply arrives. So M3's authority is exercised two ways:

- **At write time:** every transition goes through `POST /api/documents/:id/transition`, which runs the
  shared engine before writing the **local** CouchDB replica. This is offline-capable because the
  device's local stack (local Express + local CouchDB) serves it without the remote peer — the same
  local-first posture as M1/M2 document writes.
- **On sync:** a **reconcile pass** surfaces concurrent transitions made on different replicas (and
  flags any unreachable state) through the existing conflict queue.

See [03-workflow-runtime.md](03-workflow-runtime.md) for the full model, including why the browser
client does not apply transitions itself.

## In scope

- `workflow:*` definition documents (states, transitions, guards, role gating).
- Workflow state on the document envelope (`state`, `stateUpdatedAt`, `stateUpdatedBy`, `history`).
- Back-compatible state: documents without a `state` field adopt the workflow's `initialState`.
- A portable shared workflow engine reused by client and server.
- Transition guards evaluated with the M2 expression runtime.
- Role-gated transitions enforced via `acl:rules`.
- A transition endpoint that runs against the local stack, so it works offline.
- Reconciliation of transitions on sync, surfacing state conflicts.
- A state-filtered worklist view and a supporting Mango index.
- Runtime UI: state badge, available transition actions, transition history, state-aware conflicts.
- Written notes on the transition model, reconciliation, and known limitations.

## Out of scope

- Scheduled or event-triggered agents and automation.
- `onEnter`/`onExit` side-effect actions beyond the state/history stamp (deferred).
- Full low-code workflow designer UI.
- Production template promotion.
- Production-grade authorization, revocation purge, or signed transitions.
- Field-level CRDT merging.
- Parallel/multi-branch workflows, sub-workflows, or timers.
- Full-text search and complex reporting.

## Product framing

M3 is not the workflow designer. It is the workflow **runtime** directly below the future designer.

The runtime should prove that definitions-as-data can control a document lifecycle in a Notes-like
replicated database, offline included.
