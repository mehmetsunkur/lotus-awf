# 03 — Handler Runtime

## Pure compute

`applyComputedFields(form, payload, doc)` (`src/shared/validation.ts`) overwrites every `compute`
field with its registered pure handler's result, after defaults are applied. It is called on:

- the **client** form runtime, recomputing live as inputs change (computed fields render read-only);
- the **server** create and update routes, before validation and persistence.

Because the function is the same pure code on both tiers, the rendered value and the stored value
agree (validation parity), with no server round-trip on the client path (offline).

An unknown or throwing pure handler fails closed to `undefined`, then is coerced by
`normalizePayload` — a bad reference can never crash a render or a save.

## Effect execution

The online transition route (`POST /api/documents/:id/transition`) applies the authoritative state
change with the shared workflow engine and **persists it first**. Only then does it run the
transition's `action` effect, via `runEffect`:

- **server-only** — effects never run on a client and never during offline transitions;
- **best-effort** — `runEffect` never throws; an unknown handler or a throwing handler becomes a
  closed-fail result. The transition is already committed, so an effect failure cannot block or
  revert the lifecycle;
- **observable** — each result is surfaced in the route response as `effects[]` and appended to an
  in-memory log readable at `GET /api/plugins/log` (cleared on `/api/reset`).

This is the M3 Option-A boundary made explicit: state changes are authoritative and offline-capable;
effects are an online, best-effort side channel.

## The offline boundary (deferred)

An offline-originated transition is applied locally and reconciled on sync — it does not pass through
the transition route, so its effect does **not** fire on reconcile in M7. Firing effects on
reconcile, persisting them as replicated documents, and durable retry are deferred to the agents work
in Phase 9.

## Definitions-as-code CLI

`scripts/app.ts` (`npm run app`) is the developer surface:

- `extract --out <dir>` writes one JSON file per definition plus a `template.json` metadata file,
  via `POST /api/templates/export`;
- `apply --in <dir>` reconstructs the artifact from those files and applies it via
  `POST /api/templates/apply`, reusing M6's validation and additive/update-only semantics.
