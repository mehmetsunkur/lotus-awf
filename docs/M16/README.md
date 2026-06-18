# M16 - Runtime And Designer Workspace Split

M16 turns an installed `.nsf` app into two explicit workspaces: Runtime for using business
documents, and Designer for changing app metadata.

## Goal

- `/expense.nsf` opens a runtime workspace with a left navigation pane and right content pane.
- Runtime navigation lists document views and create actions from replicated definitions.
- Documents remain addressable and can be opened in another browser tab.
- `/expense.nsf/designer` opens a designer workspace in its own route space.
- Designer navigation lists forms, views, and workflows for editing.
- Legacy `/expense.nsf/design/...` links continue to work by normalizing into Designer routes.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary |
| [02-route-contract.md](02-route-contract.md) | Runtime and Designer route shapes |
| [03-acceptance.md](03-acceptance.md) | Exit criteria |
| [04-implementation-notes.md](04-implementation-notes.md) | Final notes and verification |

## Core posture

Runtime is for operating the app. Designer is for changing the app. Both are driven by metadata
documents replicated to the local runtime.
