# 01 — Scope

## M4 objective

M4 establishes the first in-app authoring studio over replicated definitions. A user should be able
to edit form, view, and workflow definitions with structured controls, save them locally, and see the
runtime change without touching raw JSON.

## In scope

- Structured editing for existing `form:*`, `view:*`, and `workflow:*` documents.
- Shared definition validation used by the client and API before local CouchDB writes.
- The existing JSON editor remains as a developer escape hatch.
- Local-first saves: all edits write the local replica and replicate later.
- E2E coverage for studio-driven edits and invalid definition rejection.

## Out of scope

- Drag-and-drop layout editing.
- Visual workflow graph editing.
- Hardened citizen-authored expression sandboxing.
- Field-level definition conflict merge.
- Template promotion, plugins, agents, search, and production authorization.

## Product framing

M4 is the minimum viable authoring loop: definitions are still ordinary replicated documents, but the
primary path is no longer hand-editing JSON.
