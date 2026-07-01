# ADR-0015: Retire the expense base specialization (expense.nsf as a pure template)

Date: 2026-07-01

## Status

Proposed. Runtime/logic de-specialization implemented and verified (API + unit + 7/8
API-driven e2e). Client cosmetic genericization and the deploy-test hand-migration remain
as tracked follow-ups (need a reliable UI/Docker environment to verify).

## Context

lotus-notes is a code-as-data platform, but the **expense** sample was baked into the base
binary. Its *data* was an installable template (`templates/expense/*`), yet its *code* was
hardcoded across the runtime: `resolveBusinessApp` special-cased `"expense"`, `config.appDb`
defaulted to `expense_app` across ~40 functions, `createDocument` stamped `appId: "expense"`,
the unscoped `/api/documents` + `/expense.nsf` routes defaulted to it, `/api/reset` auto-installed
it, and `readersForNewDocument` carried an `if (docType === "expense")` finance rule. This is the
same specialization removed for org.nsf — a deployed app must not require app-specific base code.

## Taxonomy

- Subsystem: Server, Shared, Client
- Domain Area: App lifecycle, Definition contract, Identity & ACL
- Risk Class: Contract / back-compat (breaking API), Security (ACL / readers)
- Runtime Surface: Internal API, Web UI, Deploy Artifact

## Decision

Make expense a **pure installable template** with no structural trace in runtime code:

- `resolveBusinessApp` resolves every app (incl. expense) via its `appinstall:*` record — nothing
  assumed. Generic `POST /api/platform/install-sample/:appId` (registry-driven) replaces the
  expense-specific route; `samples[]` is built from the template registry.
- The `|| "expense"` default in `appContextFromRequest` is removed — it now requires an
  `:appId`, so unscoped business requests no longer resolve to a default app and the runtime is
  **app-scoped only** (`/api/apps/:appId/*`). (The now-inert unscoped route *strings* are left
  registered for a follow-up cleanup; they cannot resolve without an app.) `createDocument` takes
  an explicit `appId`; the `docType="expense"` fallbacks and `getBusinessDocs` default are gone.
  `"expense"` leaves `RESERVED_APP_IDS`. (`config.appDb` remains only as a dev/scripts default,
  not a runtime path — a minor residual.)
- The finance-visibility rule becomes **data**: `FormDefinition.defaultReaders` (validated), read
  by `readersForNewDocument`. The expense template carries `defaultReaders: ["group:finance"]`, so
  behavior is preserved with zero app-specific base code. It stays in `src/shared/access.ts` so
  client and server agree, and it reads only local form data (offline-safe).
- `/api/reset` completes setup and installs expense through the *generic* path for dev/e2e; tests
  drive apps via app-scoped routes (the `catalog-apps.spec.ts` pattern).

## Alternatives considered

1. **Keep a generic configurable default app** powering unscoped routes — rejected: a "default
   app" privilege in base is still a specialization, just parameterized.
2. **Drop the finance readers rule** — rejected: changes the approval behavior; `defaultReaders`
   preserves it as data.
3. **Staged (de-specialize, keep aliases)** — rejected by the owner in favor of a full retire.

## Consequences

- Positive: expense installs and behaves exactly like a catalog-created app; base carries no
  app-specific routing/seed/readers logic; the pattern generalizes to any future sample.
- Positive: `defaultReaders` is a reusable, data-driven readers policy for every app.
- Negative: **breaking** — the unscoped `/api/documents` and default `/expense.nsf` routes are
  removed and `/api/reset` no longer auto-installs expense, so ~8–10 e2e specs + `fixtures.ts` +
  deploy probes migrate to app-scoped routes. Landed as staged commits to keep the suite green at
  the seams.

## Residual (documented, not removed here)

The expense template still references two **compiled sample handlers** in `HANDLER_MANIFEST`:
`expense-total-with-tax` (a `compute`/pure handler) and `record-activity` (an `agent` handler).
These are the last non-structural traces. Neither is blocked by hard architecture:

- `expense-total-with-tax` can become a **compute formula** reusing the existing sync expression
  engine (`Math.round(payload.amount * 1.2 * 100) / 100`) — small, unbuilt wiring.
- `record-activity` can become a **formula-defined agent** (the *read/compute* subset of the
  parked ADR-0014 write-side — it performs no writes, so the `service:<appId>`/reconcile machinery
  does not apply).

The one genuine cross-cutting blocker to converting arbitrary author handlers is **safe
server-side execution of author formulas** (unbounded-loop/DoS; forms/views are safe by
construction, formulas are not). Fine for first-party templates; needs an execution deadline
(worker/VM) before exposing to untrusted authors. Tracked as follow-up, not done here.

## Follow-ups

- Client cosmetics: genericize the catalog sample card (loop `state.samples`), drop
  `DEFAULT_EXPENSE_VIEW_ID` and the `route.app === "expense"` branches (UI — verify in a real
  browser).
- Deploy test: hand-migrate `tests/deploy/deploy-artifact.ts` to app-scoped routes (mind the
  404-before-install vs 401 ordering) and verify under Docker.
- Delete the now-inert unscoped route strings; remove the `config.appDb` dev default.
- Convert `expense-total-with-tax` to a compute formula; `record-activity` to a formula agent.
- Async-lane execution deadline (also benefits ADR-0014).
- Run the multi-lens `review-change` workflow (Tier-3) once the above land.
