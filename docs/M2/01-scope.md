# 01 — Scope

## M2 objective

M2 establishes a metadata-driven local application runtime on top of the M1 replica substrate.

The milestone is successful when a user can change form/view definitions while offline, immediately
use those definitions to create/edit local documents, sync later, and inspect conflicts on both
business data and app definitions.

## In scope

- Richer replicated form definitions.
- Richer replicated view/list definitions.
- Multiple document types in one app database.
- `vendor` as the second sample document type.
- Simple select fields sourced from local documents.
- Shared local validation used by client and API save paths.
- A small portable expression evaluator for form behavior and validation.
- Local JSON definition editor for `form:*` and `view:*` documents.
- CouchDB Mango indexes and `_find` list queries for runtime document lists.
- Conflict inspection and manual resolution for business and definition documents.
- Written notes describing expression safety, query/index strategy, and known limitations.

## Out of scope

- Workflow engine and state transitions.
- Agents and scheduled automation.
- Full low-code drag-and-drop studio.
- Production template promotion.
- Production-grade authorization or revocation purge.
- Attachments.
- Full-text search.
- Complex reporting or joins.
- Field-level CRDT merging.

## Product framing

M2 is not the app builder. It is the runtime substrate directly below the future builder.

The runtime should prove that definitions-as-data can control forms, validation, views, and local
editing in a Notes-like replicated database.

