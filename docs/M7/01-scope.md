# 01 — Scope

## M7 objective

Establish the plugin/handler-runtime foundation: app definitions can reference named native handlers
that the runtime resolves and runs — pure handlers offline on every tier, effect handlers server-side
when a workflow transition runs.

## The plugin model (key decision)

Handlers are **name-registered native code, NOT replicated data**. A definition references a handler
by name; the implementation is TypeScript that ships with the app. This is the vision's
"definitions-as-code SDK + plugin SDK" developer tier — developers write code, citizens reference it.

The alternative — storing plugin **code** as replicated documents and executing it in a sandbox —
would replace the expression runtime's entire denylist security model (see
`docs/invariants.md` → Expression runtime). It is deferred to a later milestone.

## In scope

- A portable handler **manifest** (`name`, `kind`, `description`) as the validation source of truth.
- Optional definition references: `FormField.compute` (→ `pure`), `WorkflowTransition.action` (→ `effect`).
- A pure-handler registry in `src/shared/` and an effect-handler registry in `src/server/`.
- Computed fields applied via one shared function on **both** client and server save paths.
- Effect handlers run on the **online transition route only**, best-effort and fail-closed.
- `GET /api/plugins/manifest` and `GET /api/plugins/log`.
- A definitions-as-code CLI (`scripts/app.ts`: `extract`, `apply`) over the M6 promotion API.

## Out of scope

- Replicated/sandboxed code plugins (the security-model replacement).
- Firing effects during reconcile of an **offline-originated** transition (online route only for now).
- Persisting effects as replicated documents; durable retry/queueing (that is Phase-9 "agents").
- A new replicated `plugin:*` definition kind.
- Plugin packaging, distribution, or third-party untrusted-plugin isolation.
- Production authorization for the plugin endpoints (same non-production trust posture as M4–M6).

## Product framing

M7 is the Notes "formula/handler" analog re-centered on offline-first: the citizen sees a field that
fills itself and a transition that does something; the developer owns the code behind both.
