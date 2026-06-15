# M3 — Workflow Engine

M3 builds on the M2 metadata-driven runtime by giving documents a **lifecycle**: replicated
`workflow:*` definitions describe states and transitions, and the runtime advances documents through
those states — offline-first, like everything else in the platform.

M1 proved the CouchDB replica substrate. M2 proved replicated definitions can drive forms, views,
validation, and local editing. M3 proves those same definitions-as-data can drive **state
transitions** with guards, role gating, history, and sane reconciliation on sync.

## Goal

Add a portable, metadata-driven workflow engine:

- describe lifecycle as replicated `workflow:*` documents (states, transitions, guards, roles);
- store workflow state on the document envelope, back-compatible with existing replicated docs;
- evaluate transition guards offline with the M2 expression runtime;
- advance state **optimistically offline** and **reconcile on sync** (vision Option A);
- gate transitions by role using `acl:rules`;
- surface concurrent-transition conflicts in the existing conflict queue;
- render state badges, available actions, and transition history in the runtime.

## Documents

| Doc | Purpose |
|-----|---------|
| [01-scope.md](01-scope.md) | What M3 includes and excludes |
| [02-data-contract.md](02-data-contract.md) | `workflow:*` definition + envelope state extensions |
| [03-workflow-runtime.md](03-workflow-runtime.md) | Transition model, Option A decision, CouchDB reconcile caveat |
| [04-build-plan.md](04-build-plan.md) | Suggested implementation order |
| [05-acceptance.md](05-acceptance.md) | Demo scenarios and exit criteria |
| [06-implementation-notes.md](06-implementation-notes.md) | Implemented M3 behavior, verification, and limitations |

## Core posture

M3 is the first milestone that lets a document **change state**, not just change data.

The working question is:

> Can replicated `workflow:*` definitions drive offline-first state transitions that reconcile on
> sync without losing data or leaking illegal states?
