# M23 - Workflow Studio And Approval Scaffold

M23 closes the main authoring gap between catalog-created apps and the workflow runtime. Designers can
add a standard approval lifecycle to a document type from the app Designer without hand-authoring JSON.

## Goal

- Scaffold an approval `workflow:<docType>` for a document type that has no workflow yet.
- Generate worklist views for submitted, personal, and all documents.
- Let the designer choose an approver person or group from the existing directory.
- Keep generated workflow/views as ordinary replicated design documents.
- Preserve the existing workflow engine, transition authorization, document ACL, and template export
  contracts.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary and non-goals |
| [02-scaffold-contract.md](02-scaffold-contract.md) | Generated definitions and API contract |
| [03-runtime-flow.md](03-runtime-flow.md) | Designer UI and runtime behavior |
| [04-build-plan.md](04-build-plan.md) | Implementation sequence |
| [05-acceptance.md](05-acceptance.md) | Exit criteria and verification |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

M23 adds a citizen-friendly workflow scaffold, not a general visual workflow designer. The generated
definitions use the same M3 workflow engine and M4 definition validation paths already used by the
JSON editor.
