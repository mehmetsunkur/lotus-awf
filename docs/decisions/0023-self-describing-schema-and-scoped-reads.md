# ADR-0023: Self-describing schema and scoped reads

Date: 2026-07-24

## Status

Accepted — Phase 0-1 (self-describing contract) implemented 2026-07-24. Phase 2
(runtime transition affordances + scoped read endpoints/tools) implemented
2026-07-24.

## Context

An operator agent (ADR-0021/M28) driving a business app over the MCP workspace surface
learns the app's schema from `get_app_definitions`, which returns every `form:*`/`view:*`/
`workflow:*` document in full. The definitions are structurally complete but *semantically
mute*: nothing tells the agent what an app is *for*, what a `triaged` state *means*, when
to fire the `convert` transition versus `decline`, or which field carries the datum a
downstream reader needs. The agent has to infer intent from identifiers (`workPerformed`,
`needs-parts`) and from guard expressions it must reverse-engineer.

A real failure from the field-services playground run (`codex/01-dana`, 2026-07-24) shows
the cost: the agent dropped a customer-supplied identifier (`VAC-SEAL-42`) on
`create_document` because no field's purpose was legible to it, and the value was
unrecoverable to the technician who lacked read access to the originating request. The
schema *was* self-consistent; it was not *self-explanatory*.

Two things are missing, and they compose:

1. **Prose.** The definition contract has no channel for authored intent at the
   app/form/view/workflow/state/transition/column level. `FormField.helpText` is the only
   description-shaped field, and only at field granularity.
2. **Progressive disclosure.** `get_app_definitions` is all-or-nothing. An agent that
   wants "just the work-order workflow" pays for every definition in the app.

This ADR settles (1) now and scopes (2) as a follow-up that (1) makes worthwhile.

## Taxonomy

- Subsystem: Shared (definition contract + validator); Server (install-time mirror);
  MCP (`lotus_admin_list_apps` surface, future scoped tools).
- Domain Area: Definitions-as-data contract, Design-time authoring, MCP agent interface.
- Risk Class: Back-compat (definition-shape change), Validation parity (client + API).
- Runtime Surface: Design documents (replicated), Internal API (Express), MCP stdio/HTTP.

## Decision

### Phase 0-1 — self-describing schema (shipped)

1. **Optional `description?: string` on every definition node that has authored intent**:
   `AppConfig`, `FormDefinition`, `ViewColumn`, `ViewDefinition`, `WorkflowState`,
   `WorkflowTransition`, `WorkflowDefinition` (`src/shared/types.ts`). Descriptive prose,
   **never a gate** — nothing in the runtime branches on it. The highest-value targets are
   **workflow state and transition descriptions**: they carry the operating knowledge an
   agent most needs (what a state means; when a branch applies; what a guard requires in
   words).

2. **Field-level prose stays on `helpText`.** We deliberately do **not** add a parallel
   `FormField.description`. `helpText` already exists, already renders in the runtime form,
   and already carries field guidance in shipped apps — a second field-level channel would
   fork authoring and drift. `helpText` *is* the field-level description channel.

3. **Validated only when present** (`src/shared/definition-validation.ts`,
   `validateDescription`): absent → no error (back-compat); present and non-string → a
   pathed error (`description`, `columns.N.description`, `states.N.description`,
   `transitions.N.description`). This runs inside the existing shared validator, so client
   and API enforce identically (validation-parity invariant).

4. **Authoritative copy lives on `app:config`; a cheap mirror lands on `AppInstall`.**
   `AppInstall.description` is populated from `app:config.description` at install time
   (`appInstallRecord` / the install route in `src/server/index.ts`) so
   `lotus_admin_list_apps` — which reads only `installedApps()` from the platform db — can
   show each app's purpose without opening every app database. The mirror is a
   denormalized convenience: `app:config` remains authoritative, and a later designer edit
   to `app:config.description` is **not** re-mirrored (accepted staleness for a purpose
   blurb; see Follow-Ups).

5. **Backfill.** Bundled templates (`templates/*/template.json`) get an app-purpose blurb;
   the field-services playground fixture
   (`tests/mcp/agent/fixtures/field-services/template.json`) is described end-to-end —
   app, forms, and every workflow state and transition — so the agent acceptance path
   exercises real prose.

### Phase 2 — runtime affordances + scoped reads (implemented 2026-07-24)

Shipped in two increments. Both are additive read surfaces over the authenticated
Express API — no contract change, no mutation, back-compat by construction.

6. **Runtime transition affordances on document-open (the highest-value piece).**
   `GET /api/apps/:appId/documents/:id?include=transitions` wraps the response as
   `{ document, availableTransitions }`; without the flag the bare document is returned
   unchanged (every existing reader — and the direct test helpers — keep the old shape).
   Each affordance carries `id`, `label`, `to`, the transition's ADR-0023 `description`,
   and — best-effort — the `helpText` of the form fields its guard reads (a static
   `payload.<field>` scan; advisory, never a gate). The block is computed by the shared
   `transitionAffordances`/`availableTransitions` (the sync **parity** lane, ADR-0019),
   so a surfaced action is exactly one the transition endpoint would authorize — offering
   and enforcement cannot diverge. The workspace `get_document` tool always requests it.
   This answers the agent's runtime question ("what can I do now, and what does it mean")
   that the field-services failure exposed — not just the design-time schema question.

   *This item was not in the original Phase 2 sketch (which was scoped-reads only). It was
   added because the same self-describing prose is most useful at the decision point — the
   moment an agent holds a document and must choose a transition.*

7. **Progressive-disclosure read tools**: a lean `get_app_definitions` (ids + kinds +
   titles + descriptions, no field/column/state bodies, served by
   `GET /definitions/summary`) plus `get_form(docType)` / `get_workflow(docType)` /
   `get_view(viewId)` returning one full definition (new
   `GET /definitions/{forms,workflows}/:docType` and `/definitions/views/:id` routes).
   Views are keyed by **view id**, not docType, because they are N-per-docType (matching
   `query_view`). The full `/definitions` endpoint is **left untouched** — the client
   editor and the designer surface (`lotus_designer_get_app_definitions`) still read it in
   full; only the *workspace* tool went lean, by projecting server-side through the new
   summary route. These become genuinely useful *because* Phase 0-1 makes the lean listing
   self-explanatory.

## Alternatives Considered

1. **A parallel `FormField.description` alongside `helpText`** — rejected (Decision §2):
   two field-level prose channels fork authoring and drift; `helpText` already serves.
2. **Read `app:config.description` live in `list_apps` instead of mirroring** — rejected
   for v1: it turns a single platform-db read into an N-app fan-out for a cosmetic blurb.
   The mirror keeps the list cheap; accepted cost is staleness on later edits.
3. **Ship Phase 2 scoped reads in the same change** — rejected: the contract addition is
   back-compat and low-risk and pays off immediately (descriptions surface through the
   existing full-definition read "for free"); the new endpoints are a distinct surface
   worth their own review. Sequencing contract-first also lets the designer add authoring
   affordances in parallel without blocking readers.
4. **Make description required / structured (e.g. per-guard rationale schema)** — rejected:
   violates the back-compat invariant (newly-required field) and over-fits; free prose is
   what an agent consumes.

## Consequences

- Positive: the schema can explain itself to an operator agent at the granularity where
  decisions are made (states, transitions), with zero runtime behavior change and no
  migration — every field is optional and validated-only-when-present.
- Positive: `lotus_admin_list_apps` gains a purpose blurb at no per-call cost.
- Negative: `AppInstall.description` can drift from `app:config.description` after a
  designer edit (mirror is install-time only).
- Neutral: full-definition reads already carry the new prose, so agents benefit before the
  Phase 2 scoped tools exist; Phase 2 is an optimization, not a prerequisite.
- Positive (Phase 2): the operator learns "what can I do now, and what does it mean" on
  document-open, from the same shared engine that authorizes the write — no re-deriving
  guards. The guard-field `helpText` surface is best-effort (a static `payload.<field>`
  scan), so a missed or spurious token costs a hint, never correctness.

## Follow-Ups

- Designer authoring affordances for the new `description` fields (edit surfaces for app
  purpose, state/transition prose, view-column notes).
- Re-mirror `AppInstall.description` on `app:config` save (or drop the mirror for a live
  read) if blurb staleness proves annoying in practice.
- Backfill state/transition descriptions into the remaining bundled workflow templates
  (expense, leave-request, agent-ops, turnaround) — only app purpose is set there today.
