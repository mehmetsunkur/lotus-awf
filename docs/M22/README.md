# M22 - App Permissions And Sharing

> **Amended by ADR-0026 (2026-10-19):** per-document `readers` (and the M5 revocation purge) were removed — document visibility is the app ACL. Readers-based statements below are historical; see `docs/decisions/0026-app-acl-document-visibility.md`.

M22 adds the first in-platform app permission editor. Managers can grant directory people and groups
access to an installed business app by editing its replicated `acl:rules` design document through a
safe UI/API instead of the JSON escape hatch.

## Goal

- Show an Access section in each business app Designer.
- List sanitized directory people/groups as selectable principals.
- Let managers grant `reader`, `author`, `editor`, `designer`, or `manager`.
- Prevent updates that leave no active manager for the app.
- Keep `acl:rules` as replicated, template-exported design data.
- Preserve per-document `readers`/`authors` as the row-level security contract.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary and non-goals |
| [02-access-editor-contract.md](02-access-editor-contract.md) | API, validation, and lockout rules |
| [03-runtime-flow.md](03-runtime-flow.md) | Designer UI and app-sharing flow |
| [04-build-plan.md](04-build-plan.md) | Implementation sequence |
| [05-acceptance.md](05-acceptance.md) | Exit criteria and verification |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

App sharing edits app-level ACL design data. It does not widen existing document visibility; document
`readers` and `authors` remain authoritative for rows.
