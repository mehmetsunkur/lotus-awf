# Shared

## Doc Sync Metadata

- Last code review baseline: `bbdadaf`
- Last reviewed date: `2026-06-16`
- Code areas:
  - `src/shared/**`
- Tests:
  - `tests/unit/**`
  - `tests/e2e/**`
- Config/runtime areas:
  - `tsconfig.json`
- Review trigger:
  - Update this doc when the definition contract, validation rules, the expression runtime, or the
    workflow engine change.

## Purpose

Portable, dependency-free contract and logic imported by **both** the client and the server.
No DOM, no Node/server-only APIs.

## Main Files

- `src/shared/types.ts` — `FormDefinition`, `ViewDefinition`, `WorkflowDefinition`, `FormField`,
  `BusinessDocument` (incl. optional `state`/`history`), `TransitionEvent`, etc.
- `src/shared/access.ts` (M5) — pure helpers for principals, readable docs, editable docs, derived
  readers, and access selectors.
- `src/shared/validation.ts` — `validatePayload`, `applyFormDefaults`, `normalizePayload`, `isFieldRequired/Visible/ReadOnly`.
- `src/shared/definition-validation.ts` (M4) — shared validators for `form:*`, `view:*`, and
  `workflow:*` documents before local definition writes.
- `src/shared/template.ts` (M6) — template normalization, `_rev` stripping, artifact validation, and
  document-level diff helpers.
- `src/shared/expression.ts` — `evaluateExpression`, `evaluateBoolean` (portable evaluator).
- `src/shared/workflow.ts` (M3) — portable workflow engine: `currentState`, `availableTransitions`,
  `applyTransition`. Pure; reuses `evaluateBoolean` for guards and fails closed on a bad guard.
- `src/shared/agents.ts` (M8) — pure agent matching/scheduling: `agentIsDue`, `agentMatchesChange`,
  `agentRunKey`. The server orchestrates I/O around these; they hold the decisions.
- `src/shared/search.ts` (M9) — pure full-text matcher: `fold`, `tokenize`, `searchableFields`,
  `scoreDocument`, `searchDocuments` (accent-folded, AND-of-terms, prefix, field-weighted ranking).
  Identical client/server/local-replica; the server applies it to the ACL-scoped set.
- `src/shared/audit.ts` (M10) — pure audit/retention decisions: `auditAction` (create/update/delete
  inference), `shouldAudit` (business docs only; skips the audit/agent runtime kinds; docTypes
  allowlist), `eventIsExpired` (retention horizon). The server's CDC recorder orchestrates I/O around
  these.
- `src/shared/form-layout.ts` (M11) — pure form-layout ops (`ensureSections`, `moveFieldWithinSection`,
  `moveFieldToSection`, `add/rename/move/removeSection`, `addFieldToSection`, `removeField`,
  `renameField`, `isLayoutNormalized`). The citizen studio routes every layout mutation through these;
  each preserves the normalized form (sections non-empty, every field in exactly one section).
- `src/shared/scaffold.ts` (M12) — pure document-type scaffold: `slugifyDocType`, `validateDocType`
  (slug + reserved-kind guard), `scaffoldDocumentType(appId, docType, title)` → `{ form, view }` (both
  pass the shared validators). The server validates and writes the pair around it.
- `src/shared/handlers/manifest.ts` (M7) — declared handler manifest (`name`, `kind`); the portable
  source of truth for validating `compute`/`action` references.
- `src/shared/handlers/pure.ts` (M7) — pure handler registry + `runPureHandler` (fails closed).
  `validation.ts` exposes `applyComputedFields` over it.

## Key Flows

A form/view/workflow definition (data) is read by both tiers; the same validation, expression, and
workflow code runs in the browser and in the API, so behaviour is identical offline and online. For
workflow the browser uses `availableTransitions` (to render actions) and the server uses
`applyTransition` (to authorize the write) — one module, so the two cannot diverge. `now` is the one
non-deterministic context value (sampled per side), so guards must not gate on it.

M4 adds shared definition validation: the browser uses it before saving from the authoring studio or
JSON editor, and the API uses it before writing `form:*`, `view:*`, or `workflow:*` to local CouchDB.

M5 adds shared access policy: the server uses the same `readers`/`authors` helpers for document lists,
view rows, sourced select options, payload writes, transitions, replication selectors, and purge.

M6 adds shared template helpers so export/diff/apply all compare definition documents consistently
without carrying source-environment `_rev` values.

M7 adds the pure-handler runtime: a definition's `compute`/`action` reference is validated against the
shared manifest on both tiers, and `applyComputedFields` derives computed fields with the same pure
code in the browser and on the API save path.

M8 adds the agent contract (`agent:*`) and pure matching engine; the agent `handler` reference is
validated against the manifest (kind `agent`) by the same shared definition validator.

M9 adds the pure search matcher and an optional `FormField.searchable` flag (text-ish fields default
on, validated by the shared definition validator). The matcher is deterministic and portable, so search
is identical offline and on the server; the server applies it only to the already ACL-scoped set.

M10 adds the pure audit/retention engine and the `audit:policy` design-doc kind (validated by the
shared validator). The decisions are deterministic; the server's CDC recorder writes `auditevent:*`
runtime docs and prunes them by policy around these functions.

M11 adds the pure form-layout engine. The citizen layout studio routes every section/field mutation
through it, so the reorder/regroup rules are deterministic and unit-tested, and the form stays
normalized (every field in exactly one section) — the runtime renders by section.

M12 adds the pure document-type scaffold. Creating a type builds a form + list view from it (both
validated by the shared validator) so a brand-new type is reachable in the runtime; the server writes
the pair local-first.

## Existing Patterns

- Pure functions over definitions, payloads, and docs — no I/O, no DOM, no Node/server-only APIs.
- Definition shape changes go in `types.ts` first, then `seed-data.ts` and the API.

## Invariants

See `docs/invariants.md`: **Validation parity**, **Expression runtime**, **Definitions-as-data
contract** all govern this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`

## Tests

Vitest unit tests under `tests/unit/**` (M7) cover the handler registry, computed fields, and
reference validation; the broader runtime is still exercised through `tests/e2e/**`.

## Common Pitfalls

- Adding a rule to the client or a definition only, breaking client/API parity.
- Adding definition validation only in the client or only in the API.
- Inlining an access rule in server routes instead of using `src/shared/access.ts`.
- Comparing or applying templates with ad hoc JSON logic instead of `src/shared/template.ts`.
- Importing anything Node- or DOM-specific into `src/shared` (breaks portability).
- Widening the expression evaluator in a way that is unsafe or non-deterministic.
