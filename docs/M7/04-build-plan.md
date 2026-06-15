# 04 — Build Plan

## Step 1 — Contract + registry + manifest

Add optional `compute?`/`action?` to the definition types and `HandlerKind`/`HandlerManifestEntry`.
Add the portable manifest and the pure-handler registry (fails closed). Add Vitest for `src/shared`
unit tests.

## Step 2 — Validation + computed fields

Add `applyComputedFields` (shared) and manifest-checked reference validation in
`definition-validation.ts`. Unit-test the registry, computed fields, and reference validation.

## Step 3 — Server effect handler + wiring

Add the server effect registry (`runEffect`, best-effort, in-memory log). Apply computed fields on
the document save routes; run the transition's effect after the authoritative write; expose
`/api/plugins/manifest` and `/api/plugins/log`; clear the log on reset. Unit-test the effect runtime.

## Step 4 — Client computed fields

Render computed fields read-only and recompute them from the live draft via the shared function.

## Step 5 — Seed + e2e

Seed a computed `gross` field and an `audit-transition` effect. Add `tests/e2e/plugins.spec.ts`
covering live offline recompute, server-side parity on save, effect execution + logging, and the
manifest endpoint.

## Step 6 — Developer CLI

Add `scripts/app.ts` (`extract`/`apply`) over the M6 promotion API and the `app` npm script.

## Step 7 — Docs

Add these M7 docs; add the handler/plugin invariant (with `Paths:`) and a taxonomy risk class;
reconcile the `docs/context/*` cards.

## Step 8 — Verify

`npm run build`, `npm run test:unit`, `npm run test:e2e`; run the Tier-3 multi-lens review on
`main..HEAD`.
