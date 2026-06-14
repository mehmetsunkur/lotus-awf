# Shared

## Doc Sync Metadata

- Last code review baseline: `928f4be`
- Last reviewed date: `2026-06-14`
- Code areas:
  - `src/shared/**`
- Tests:
  - `tests/e2e/**`
- Config/runtime areas:
  - `tsconfig.json`
- Review trigger:
  - Update this doc when the definition contract, validation rules, or expression runtime change.

## Purpose

Portable, dependency-free contract and logic imported by **both** the client and the server.
No DOM, no Node/server-only APIs.

## Main Files

- `src/shared/types.ts` — `FormDefinition`, `ViewDefinition`, `FormField`, `BusinessDocument`, etc.
- `src/shared/validation.ts` — `validatePayload`, `applyFormDefaults`, `normalizePayload`, `isFieldRequired/Visible/ReadOnly`.
- `src/shared/expression.ts` — `evaluateExpression`, `evaluateBoolean` (portable evaluator).

## Key Flows

A form/view definition (data) is read by both tiers; the same validation and expression code
runs in the browser and in the API save path, so behaviour is identical offline and online.

## Existing Patterns

- Pure functions over `(form, payload, doc)` — no I/O, no globals.
- Definition shape changes go in `types.ts` first, then `seed-data.ts` and the API.

## Invariants

See `docs/invariants.md`: **Validation parity**, **Expression runtime**, **Definitions-as-data
contract** all govern this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`

## Tests

No direct unit tests yet (a known gap — `src/shared` is pure and ideal for them). Currently
exercised indirectly through `tests/e2e/**`.

## Common Pitfalls

- Adding a rule to the client or a definition only, breaking client/API parity.
- Importing anything Node- or DOM-specific into `src/shared` (breaks portability).
- Widening the expression evaluator in a way that is unsafe or non-deterministic.
