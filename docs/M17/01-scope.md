# 01 - Scope

## In Scope

- Add checked-in Expense template artifacts under `templates/expense/`.
- Keep app design and sample business records in separate JSON files.
- Add a small server-side template registry/loader for packaged sample apps.
- Install `/api/platform/install-sample/expense` from the registry instead of hardcoded seed data.
- Keep `seedDocuments()` available for scripts and e2e fixtures by loading the same artifacts.
- Validate template and sample artifacts before writing them to CouchDB.
- Update deploy verification so the packaged install path continues to prove setup, catalog, runtime,
  design mutation, agents, audit, template export, and replication.

## Out Of Scope

- Remote marketplace or uploaded template registry.
- Version rollback or governed upgrade flows.
- Multi-app routing beyond the existing Expense runtime.
- Embedding executable code in JSON templates.
- Plugin package deployment.
- Production auth, secrets management, or tenant isolation.

## Decision

M17 uses a filesystem-backed registry for built-in samples. The initial registry contains
`sample:expense`, backed by `templates/expense/template.json` and `templates/expense/sample-data.json`.
The install route still installs demo data because it is a sample install, but reusable template
promotion remains design-only.
