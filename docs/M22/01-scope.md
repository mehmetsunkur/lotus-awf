# 01 - Scope

## Objective

Let app managers configure app-level access for installed business apps from the app Designer.

## In Scope

- Add an Access section to the Designer workspace.
- Add app-scoped access APIs under `/api/apps/:appId/access`.
- Return sanitized directory people/groups for principal selection.
- Save app ACL entries to the app's `acl:rules` document.
- Validate principals and access levels.
- Normalize duplicate entries to one entry per principal.
- Reject updates that leave no active manager for the app.
- Preserve `acl:rules` in template export/apply.
- Add e2e and deploy coverage for granting access to another user.

## Out Of Scope

- Full Domino ACL semantics such as Depositor, No Access, delete flags, or private views.
- Per-form, per-view, or per-field ACL.
- Document-level reader/author editing UI.
- Backfilling existing documents' `readers` or `authors` after app ACL changes.
- Nested groups.
- External identity providers.
- App deletion, rename, or environment promotion governance.

## Decision

M22 edits only `acl:rules.entries`. It intentionally does not introduce a separate permission store.
