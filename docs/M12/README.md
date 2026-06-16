# M12 — Create a Document Type

M12 lets a citizen **create a new document type from scratch** in the studio — a form plus a list view,
scaffolded in one action — so the platform finally delivers the north star's *"a power-user builds an
app… entirely in the studio."* M4–M11 could edit existing definitions (including visual layout); M12
adds the missing **create** path.

## Goal

- A pure scaffold (`src/shared/scaffold.ts`) that builds the starter **form + list view** for a new
  document type, validated by the existing shared validators.
- `POST /api/document-types {docType, title}` — slug-validated (422), reject-if-exists (409), writes
  both definitions local-first via the existing upsert.
- A generic `createDocument(docType, …)` so a new type's documents are stamped correctly (replacing the
  hardcoded expense/vendor branch).
- A "New document type" form in the studio that surfaces the new type immediately.
- No new substrate, no new Mango index; the scaffolded view binds the existing kind+docType index.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary, the scaffold decision, non-goals |
| [02-scaffold-contract.md](02-scaffold-contract.md) | docType rules, the form/view scaffold, the API |
| [03-create-runtime.md](03-create-runtime.md) | The endpoint, the generic constructor, the UI |
| [04-build-plan.md](04-build-plan.md) | Implementation steps |
| [05-acceptance.md](05-acceptance.md) | Demo flow and exit criteria |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

M12 is the Notes "new application" gesture re-centered on definitions-as-data: the citizen names a type,
the platform scaffolds the definitions that make it real, and it is immediately usable end-to-end.

The working question is:

> Can a citizen create a usable document type from scratch — a form and a view — that is immediately
> reachable in the runtime, with valid, promotable definitions and correctly stamped documents, without
> new substrate?
