# 01 — Scope

## M6 objective

M6 establishes the template-promotion foundation from the vision: app definitions can be exported as
one versioned artifact, diffed against the current local app, and applied back to the local replica.

## In scope

- Versioned template artifact contract.
- Export of app/config, form, view, workflow, and ACL definition documents.
- Document-level diff by definition id.
- Additive/update-only apply into local CouchDB.
- Validation before apply.
- API-level e2e coverage.

## Out of scope

- Persisted template registry.
- Environment binding UI.
- Field-level diff.
- Destructive delete-missing apply.
- Plugin packaging.
- Business document export.
- Production admin authorization for promotion.

## Product framing

M6 is the modern `.ntf` design-refresh substrate, not the complete promotion workflow.
