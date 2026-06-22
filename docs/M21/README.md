# M21 - Catalog-Created Apps

M21 turns the catalog from a sample installer into the place where admins create real business
`.nsf` apps. A newly created app gets its own CouchDB database, install record, starter metadata, and
opens through the generic M20 runtime shell.

## Goal

- Create a new business app from `/catalog.nsf`.
- Use the app id as the `.nsf` route slug and canonical app identifier.
- Create a matching local/server CouchDB database for the app.
- Seed starter definitions for `app:config`, `acl:rules`, `audit:policy`, one form, and one view.
- Route arbitrary installed business apps through the metadata runtime.
- Keep `expense.nsf`, `setup.nsf`, and `catalog.nsf` compatible.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary and non-goals |
| [02-app-contract.md](02-app-contract.md) | App id, database, install, and starter definition contract |
| [03-route-api-contract.md](03-route-api-contract.md) | Dynamic `.nsf` routes and app-scoped APIs |
| [04-build-plan.md](04-build-plan.md) | Implementation sequence |
| [05-acceptance.md](05-acceptance.md) | Exit criteria and verification |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

The catalog creates apps, not just sample installs. System apps remain special, but business apps are
resolved by install records and run through one generic metadata runtime.
