# M14 — First-Run Setup App and Empty Catalog

M14 corrects the deploy experience from "boot directly into the Expense sample" to "boot into the
platform." A fresh Lotus deployment installs `setup.nsf`, collects organization/domain/admin setup,
then lands in an empty app catalog. The Expense app becomes an optional sample template.

## Goal

- Fresh deploy does not show `Expense Replica`.
- Fresh deploy installs `setup.nsf` / `setup_app` plus the platform catalog database.
- First-run setup captures organization name, domain name, admin username, and admin password.
- After setup, the catalog starts empty.
- The Expense sample can be installed explicitly from the catalog.
- Existing single-app Expense runtime remains available after installing the sample. M20 later
  generalizes the shell so system apps and Expense share the standard NSF workspace.
- The deploy gate verifies the setup -> empty catalog -> sample install -> runtime smoke path.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary and deferred work |
| [02-platform-contract.md](02-platform-contract.md) | Setup/platform state and API contract |
| [03-runtime-flow.md](03-runtime-flow.md) | Client boot modes and deploy behavior |
| [04-acceptance.md](04-acceptance.md) | Exit criteria and verification |
| [05-implementation-notes.md](05-implementation-notes.md) | Final notes and verification |

## Core posture

M14 is the first app-OS milestone:

> A deployed Lotus server starts as a platform, not as a sample business app.
