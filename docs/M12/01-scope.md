# 01 — Scope

## M12 objective

Let a citizen create a new document type from scratch — scaffolding a form and a list view in one
action — so a brand-new type is immediately usable end-to-end in the runtime.

## The create model (key decision)

Creation is a dedicated **`POST /api/document-types`** that scaffolds a **form + view together** (a type
is only reachable in the runtime with both), built by a pure `src/shared/scaffold.ts` and written
local-first through the existing upsert. A generic `createDocument(docType, …)` replaces the hardcoded
expense/vendor constructor so any new type's documents are stamped correctly. Scaffolding a workflow is
deferred — new types are state-less (the back-compat path). See
`docs/decisions/0007-document-type-scaffold.md`.

## In scope

- A pure engine `src/shared/scaffold.ts`: `slugifyDocType`, `validateDocType` (slug + reserved-kind
  guard), `scaffoldDocumentType(appId, docType, title)` → `{ form, view }`.
- `POST /api/document-types {docType, title}`: 422 invalid slug, 409 existing type, validate both
  definitions, write via upsert.
- Generic `createDocument(docType, payload, user, readers)`; `POST /api/documents` uses it for any
  docType (expense/vendor constructors delegate to it).
- A "New document type" form in the studio; on success the picker + studio point at the new type.

## Out of scope

- Scaffolding a workflow for the new type (state-less types only).
- A rich starter form (one required `title` field by design).
- Deleting or renaming a document type.
- Multi-app support (`appId` comes from the single `app:config`).
- A generic single-definition `POST /api/definitions` (the app-shaped unit is a *type* = form + view).
- Production authorization for the endpoint (same non-production posture as M4–M11).

## Product framing

M12 is the Notes "new application" gesture re-centered on metadata: name a type, and the platform
scaffolds the definitions that make it real — a form to edit it, a view to find it — promotable as a
template like everything else.
