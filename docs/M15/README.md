# M15 — In-App Deep Links

M15 makes the inside of an installed app addressable. M14 gave the platform app-level URLs
(`/setup.nsf`, `/catalog.nsf`, `/expense.nsf`); M15 adds stable routes for views, documents, and design
definitions inside the Expense sample runtime.

## Goal

- Direct links can open specific Expense views.
- Switching views updates the URL.
- Selecting a document updates the URL.
- Direct links can select form/view/workflow definitions in the studio.
- Unknown in-app routes degrade to the default Expense view.
- The deploy artifact serves deep `.nsf` routes through the SPA fallback.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary |
| [02-route-contract.md](02-route-contract.md) | Canonical route shapes and mapping rules |
| [03-acceptance.md](03-acceptance.md) | Exit criteria |
| [04-implementation-notes.md](04-implementation-notes.md) | Final notes and verification |

## Core posture

M15 is not a generic router. It is the stable deep-link surface for the current Expense app runtime,
which future app registry/change-set/AI work can point to.
