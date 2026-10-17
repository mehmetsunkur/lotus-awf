# Shared

## Doc Sync Metadata

- Last code review baseline: `d5953bd`
- Last reviewed date: `2026-10-12`
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
  `BusinessDocument` (incl. optional `state`/`history`), `TransitionEvent`, plus M18
  `PersonDocument`, `GroupDocument`, `SessionDocument`, `SessionState`, `AccessLevel`, and M22
  app-access editor payloads.
- `src/shared/types.ts` also carries M19 platform shell types: `SystemApp`, `PublicGroup`, and
  `DirectoryState`.
- `src/shared/directory.ts` (ADR-0012) — pure names.nsf id normalization: `normalizeUsername`,
  `personIdForUsername`, `normalizeGroupSlug` (accepts an optional `group:` prefix in any case),
  `groupIdForSlug`, `normalizePersonPrincipal`. Used by the server directory routes (re-exported from
  `src/server/auth.ts`) and the MCP admin directory tools so both resolve ids identically.
- `src/shared/access.ts` (M5/M18) — pure helpers for session-derived principal scopes, readable docs,
  editable docs, app ACL levels, and access selectors. `canEditDocument` is the ADR-0024 two-layer gate
  (Layer 1 Editor+ ACL bypass via `hasAccessLevel`; Layer 2 group/role-aware `authors` intersection).
  `rollupAclProjection(base, fields, payload)` materializes the ADR-0024 `$Readers`-style envelope
  projection — it UNIONS each `aclRole:"reader"|"author"` field's resolved principals onto the creator
  base already on the doc (additive only; never narrows). New-doc readers are just the creator's
  principals; extra readers/authors come from `aclRole` fields (ADR-0024 replaced ADR-0015's
  `defaultReaders`; `readersForNewDocument` is gone).
- `src/shared/formula.ts` (ADR-0014) — the ASYNC evaluation lane. `evaluateFormulaAsync` permits
  `await DbColumn(appId; docType; column)` / `DbLookup(appId; docType; keyColumn; key; valueColumn)`,
  every read ACL-filtered through `canReadDocument`. Distinct from `expression.ts` (the pure sync lane,
  which forbids lookups). `formulaBlockedToken` gates the sandbox at authoring time. `type: "formula"`
  form fields carry a `formula` string, are read-only, server-resolved, and excluded from the payload
  (`isPayloadField` in `validation.ts`).
- `src/shared/validation.ts` — `validatePayload`, `applyFormDefaults`, `normalizePayload`, `isFieldRequired/Visible/ReadOnly`.
- `src/shared/definition-validation.ts` (M4) — shared validators for `form:*`, `view:*`, and
  `workflow:*` documents before local definition writes. ADR-0023 adds `validateDescription`
  (type-checks the optional `description` prose only when present) wired into the form, view
  (incl. per-column), workflow, state, and transition validators.
- `src/shared/template.ts` (M6) — template normalization, `_rev` stripping, artifact validation, and
  document-level diff helpers.
- `src/shared/template-validation.ts` (M24) — pure template-design validation shared by the server
  registry, template apply endpoints, and MCP validation tools.
- `src/shared/expression.ts` — `evaluateExpression`, `evaluateBoolean` (portable evaluator).
- `src/shared/workflow.ts` (M3) — portable workflow engine: `currentState`, `availableTransitions`,
  `applyTransition`. Pure; reuses `evaluateBoolean` for guards and fails closed on a bad guard.
  ADR-0023 Phase 2 adds `transitionAffordances` (annotates the `availableTransitions` set for an
  operator agent with each transition's `description` and, when a form is supplied, the `helpText`
  of the fields its guard reads) and the `guardReferencedFields` static `payload.<field>` scan it
  uses. Advisory only — the gate is still `availableTransitions`/`applyTransition`, so the affordance
  set cannot widen authority.
- `src/shared/workflow-scaffold.ts` (M23) — pure approval workflow scaffold for a document type:
  generates `workflow:<docType>` plus submitted/my/all worklist views and validates approver
  principals before the server writes ordinary design docs.
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
view rows, sourced select options, payload writes, transitions, replication selectors, and purge. M18
changes the actor source from fixed config to authenticated `PrincipalScope` values derived from a
Person and direct Groups, and adds ranked app ACL levels (`reader` through `manager`).

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

M19 adds platform/system-app shell types. `SystemApp` records are not `appinstall:*` documents; they
describe always-present system apps such as `names.nsf`. `DirectoryState` is sanitized and must
not grow server-only password/session fields.

M22 adds shared app-access editor payloads. The server owns validation and writes `acl:rules`; the
client consumes the typed response/body so it does not invent a parallel ACL shape.

M23 adds the approval workflow scaffold helper. Generated workflow/views still use the existing
definition shapes and validators, so no replicated document shape migration is required.

## Existing Patterns

- Pure functions over definitions, payloads, and docs — no I/O, no DOM, no Node/server-only APIs.
- Definition shape changes go in `types.ts` first, then `seed-data.ts` and the API.

## ADR-0020 actor-aware view filters

`src/shared/view-query.ts` owns the pure `mangoSelector` (moved from the server) with a
REQUIRED `principals` argument: the reserved filter value `"@me"` (op `in` only, whole
value only) substitutes the caller's principal set at query time — fail-closed on an
empty scope, AND-ed with the ACL selector so it only narrows. Shared validation enforces
the value-shape rules and rejects dead `readers`/`authors` filters.

## ADR-0018/0019 workflow & field-mode additions

Fields carry a computation `mode` (`computed`/`computed-once`/`computed-for-display`,
absent = editable) orthogonal to the datatype; `src/shared/validation.ts` splits
`isPayloadField` (everything but computed-for-display) from `isEditableField` (no mode),
and server-owned values skip defaults, coercion, and user-input validation. Guards
receive the actor's `principals` (5th sync-expression arg), so per-document gating —
`principals.includes(payload.approver)` — lives in the parity lane; offering and
enforcement are exact. `src/shared/workflow.ts` owns **two** engine-stamped routing facts,
both written solely by `applyTransition` via clear-then-stamp on every state entry (full
replace, never merge; both cleared on final states; the empty set / absent person stored
field-absent, never `[]`, never an empty stamp): the standing/pool **responsibility**
(`responsible: string[]`/`responsibleAt`, from `responsibleFormula`, matched by array
element membership) and the individual **assignment** (`assignee`/`assignedAt`, scalar, from
`assigneeFormula`). ADR-0025 split these from the former single `assignee`/`assignedAt`
envelope, feeding each from a symmetric per-state formula; hand-offs land in `history[]`.
`requireAssignee` is the one opt-in fail-closed exception to "routing failure never fails a
transition" — a `group:*` normalizes away and does not satisfy it; validation rejects it on
final states and on states declaring neither `assignee` nor `assigneeFormula`. Individual
pickup ("claim") is an ordinary transition, not a new engine op. Definition validation
enforces the mode/field matrix and rejects the superseded `approverFormula`.

ADR-0024 adds a third orthogonal `FormField` axis, `aclRole:"reader"|"author"` — the
Notes-style Readers/Authors flag. It is COMPUTED-ONLY (`definition-validation.ts` rejects an
`aclRole` field that is not `computed`/`computed-once` with a formula), so its value is
server-resolved and tamper-safe. The field resolves to a principal LIST (normalized via
`normalizeResolvedPrincipals`, never primitive-coerced); `rollupAclProjection` then unions
those onto the envelope `readers`/`authors`. This replaces `FormDefinition.defaultReaders`
(deleted).

## ADR-0023 self-describing schema

Every definition node with authored intent carries an optional `description?: string`:
`AppConfig`, `FormDefinition`, `ViewColumn`, `ViewDefinition`, `WorkflowState`,
`WorkflowTransition`, `WorkflowDefinition` (`src/shared/types.ts`). Prose only — nothing in
the runtime branches on it; the high-value targets are workflow **state** and **transition**
descriptions (what a state means; when a branch applies). Field-level prose stays on
`FormField.helpText` — no parallel `FormField.description`. Fully back-compat: optional,
validated only when present (non-string → pathed error), so pre-ADR-0023 documents are
untouched and no migration is needed.

Phase 2 consumes this prose at runtime: `transitionAffordances` (workflow engine) surfaces
each available transition's `description` plus the `helpText` of guard-referenced fields, so
an operator agent sees "what can I do now, and what does it mean" on document-open. Pure and
advisory — it annotates the parity-lane `availableTransitions` set, never a new gate.

## Invariants

See `docs/invariants.md`: **Validation parity**, **Expression runtime**, **Definitions-as-data
contract**, **ACL / readers**, and **Identity & sessions** govern this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0010-directory-and-session-auth.md`
- `docs/decisions/0023-self-describing-schema-and-scoped-reads.md`

## Tests

Vitest unit tests under `tests/unit/**` (M7) cover the handler registry, computed fields, and
reference validation; the broader runtime is still exercised through `tests/e2e/**`.
`tests/unit/definition-description.spec.ts` pins the ADR-0023 `description` contract
(absent = valid; string accepted; non-string rejected with a pathed field).

## Common Pitfalls

- Adding a rule to the client or a definition only, breaking client/API parity.
- Adding definition validation only in the client or only in the API.
- Inlining an access rule in server routes instead of using `src/shared/access.ts`.
- Comparing or applying templates with ad hoc JSON logic instead of `src/shared/template.ts`.
- Importing anything Node- or DOM-specific into `src/shared` (breaks portability).
- Widening the expression evaluator in a way that is unsafe or non-deterministic.
