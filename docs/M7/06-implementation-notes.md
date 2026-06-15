# 06 — Implementation Notes

## Implemented runtime behavior

M7 adds a name-registered handler runtime:

- a portable manifest (`src/shared/handlers/manifest.ts`) declares every handler and its kind;
- `pure` handlers (`src/shared/handlers/pure.ts`) derive field values, run on client and server;
- `effect` handlers (`src/server/handlers/effects.ts`) run server-side on the transition route;
- `FormField.compute` and `WorkflowTransition.action` are optional references, validated by kind.

The seeded expense app exercises both: a computed `gross` field (`expense-total-with-tax`) and an
`audit-transition` effect on the submit transition.

## Contract and validation

`compute`/`action` are optional, so every replicated M1–M6 definition stays valid. Validation
(`definition-validation.ts`) fails closed: a reference to an unknown handler or one of the wrong kind
is rejected on both the client and the API definition-save path.

## Compute and effect semantics

`applyComputedFields` (shared) runs pure handlers after defaults on both save paths and in the client
form runtime, so the rendered and stored values agree with no offline round-trip. Computed fields are
read-only in the UI.

Effects run **after** the authoritative `putDoc` on the online transition route. `runEffect` never
throws and never reverts the transition; results are surfaced as `effects[]` and in an in-memory log
(`GET /api/plugins/log`, cleared on `/api/reset`). `GET /api/plugins/manifest` exposes the manifest.

## Developer CLI

`scripts/app.ts` (`npm run app extract|apply`) is a definitions-as-code client over the M6 promotion
API. A clean extract/apply roundtrip was verified (9 definitions, all reported unchanged).

## Verification performed

```bash
npm run build
npm run test:unit          # 15 passed
npx playwright test tests/e2e/plugins.spec.ts   # 4 passed
npm run test:e2e           # full suite
```

## Known limitations and risks

- Effects fire on the **online transition route only**; an offline-originated transition does not
  fire its effect on reconcile.
- Effects are in-memory and best-effort — no persistence, no retry, no queue.
- The plugin endpoints share the non-production trust posture of definition editing (no admin auth).
- `GET /api/plugins/log` returns the in-memory effect log (carrying `docId` and the transition
  detail) without a `readers`/`canReadDocument` filter — like the other unfiltered admin routes. Under
  the single-`appUser` model this leaks nothing (every entry was produced by that one principal acting
  on a then-readable doc, and the log clears on reset). If the server becomes multi-principal, filter
  `readEffectLog()` by `canReadDocument(scope)` or drop `docId` from entries (ACL aspect A5).
- Handlers are first-party native code; replicated/sandboxed code plugins remain out of scope.
- The manifest and pure-handler registry are kept in sync by a unit test, not by derivation.
