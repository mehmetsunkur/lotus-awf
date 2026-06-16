# ADR-0007: Create a document type via a scaffold endpoint

Date: 2026-06-16

## Status

Accepted

## Context

The north star is a power-user building an app "entirely in the studio." M4–M11 let a citizen *edit*
existing definitions (including visual layout), but not *create a new document type from scratch*. Two
constraints shaped the design: `PUT /api/definitions/:id` reads the doc before writing (so it cannot
create), and the runtime is driven by the **view picker → docType → form**, so a new type is unreachable
unless it has a view. A third, hidden constraint: `POST /api/documents` was hardcoded to the
`expense`/`vendor` constructors, so a new type's documents would be mis-stamped as `expense`.

## Taxonomy

- Subsystem: Server + Shared + Client
- Domain Area: Authoring / definition lifecycle
- Risk Class: Definition lifecycle (create path)
- Runtime Surface: Internal API + studio UI

## Decision

Add a dedicated **`POST /api/document-types` `{docType, title}`** that scaffolds a **form + a list view
together** (a type is only usable with both), via a pure `src/shared/scaffold.ts`
(`scaffoldDocumentType`). The endpoint validates the slug (`validateDocType`), rejects an existing type
(**409**), validates both definitions with the existing shared validators, and writes them local-first
through the existing upsert helper. A generic **`createDocument(docType, …)`** replaces the hardcoded
expense/vendor branch in `POST /api/documents` so any scaffolded type is stamped correctly. The studio
gets a "New document type" form; on success it points the picker and studio at the new type. Scaffolding
a **workflow is deferred** — new types are state-less (the back-compat path).

## Alternatives Considered

1. **Generic `POST /api/definitions` (single definition create)** (rejected for M12): would let a
   citizen create a lone form with no view — half a type, unreachable in the runtime. The app-shaped
   action is "create a type" = form + view.
2. **Make `PUT` an upsert** (rejected): conflates create with edit and still leaves the "needs a view"
   and "generic constructor" gaps; a focused scaffold endpoint is clearer.
3. **Scaffold form only** (rejected): not runtime-reachable without a view.
4. **Scaffold form + view via a dedicated endpoint (chosen)**: smallest end-to-end-usable unit; reuses
   the shared validators, the upsert, and template packaging unchanged.

## Consequences

- Positive: a citizen creates a working type from scratch with one action; reuses proven paths
  (validators, upsert, template export) with no substrate change and no new Mango index (the list view
  binds the kind+docType index); the generic constructor fixes a latent mis-stamping bug.
- Negative — known debt: no workflow scaffold (state-less types only); the starter form is intentionally
  minimal (one `title` field); single-app `appId` is assumed; `POST /api/document-types` has the same
  non-production auth posture as the other write endpoints.

## Follow-Ups

- Optional starter-workflow scaffold for a new type.
- Multi-app support (today `appId` comes from the single `app:config`).
- Delete/rename a document type.
