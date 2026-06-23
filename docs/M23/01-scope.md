# 01 - Scope

## In scope

- Add a Designer action for document types without a workflow.
- Generate the approval lifecycle states `draft`, `submitted`, `approved`, and `rejected`.
- Generate transitions `submit`, `approve`, `reject`, and `revise`.
- Gate `approve` and `reject` with a selected `person:*` or `group:*` principal.
- Generate worklist views for submitted, personal, and all documents.
- Support app-scoped APIs under `/api/apps/:appId/*` plus unscoped Expense compatibility.
- Include generated definitions in existing template export/apply behavior.

## Out of scope

- Arbitrary visual state-machine design.
- Parallel approvals, timers, escalations, and notifications.
- Actor-aware `My` view filter DSL.
- Document-level sharing changes.
- Automatic mutation of existing business document `readers` or `authors`.
- App rename/delete or workflow deletion.

## Taxonomy

- Subsystem: Shared, Server, Client.
- Domain Area: Definitions-as-data, workflow, app lifecycle, access control, offline-first.
- Change Type: Feature.
- Risk Class: Contract/back-compat, validation parity, ACL/readers, offline editing, index/query.
- Runtime Surface: Web UI, Internal API, Deploy Artifact.
