# M7 — Plugin / Handler Runtime

M7 adds the developer half of the vision's dual-authoring tier: definitions can invoke
**name-registered native handlers**. Citizens reference a handler by name in a definition;
developers write the handler as code that ships with the app.

M1–M6 proved the replica substrate, the metadata runtime, workflow, authoring, security, and
template promotion. M7 proves that replicated definitions can drive **reusable code** — both pure
derivations that run offline on every tier and server-only effects that run when a workflow advances.

## Goal

- Declare handlers in a portable **manifest** that is the single source of truth for validation.
- Reference a `pure` handler from a form field (`compute`) and an `effect` handler from a workflow
  transition (`action`) — optional fields, fully back-compatible.
- Run `pure` handlers identically on client and server (offline), `effect` handlers server-only.
- Make effects **best-effort**: they never block or revert the authoritative state change.
- Ship a definitions-as-code CLI (`extract`/`apply`) for the developer workflow.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary, the plugin-model decision, non-goals |
| [02-handler-contract.md](02-handler-contract.md) | Manifest, handler kinds, definition references, validation |
| [03-handler-runtime.md](03-handler-runtime.md) | Pure compute + effect execution, the offline boundary, CLI |
| [04-build-plan.md](04-build-plan.md) | Implementation steps |
| [05-acceptance.md](05-acceptance.md) | Demo flow and exit criteria |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

M7 is the modern Notes "pluggable logic" substrate, not the complete plugin platform.

The working question is:

> Can a replicated definition invoke a named, registered handler — running offline where pure,
> server-only where it does I/O — without a replicated-code sandbox and without breaking the
> definitions-as-data contract?
