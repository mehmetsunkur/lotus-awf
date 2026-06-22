# M17 - JSON App Templates

M17 moves the built-in Expense sample from hardcoded TypeScript seed data into checked-in JSON
artifacts. The milestone proves that a Lotus app can be installed from portable app definitions
rather than from bespoke seed code.

## Goal

- Store the Expense app design as a JSON `TemplateArtifact`.
- Store optional Expense demo records separately from the design template.
- Install the Expense sample through a filesystem-backed template registry.
- Keep existing deploy, e2e, seed, and reset flows compatible.
- Validate loaded templates before writing them to CouchDB.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary and non-goals |
| [02-template-artifacts.md](02-template-artifacts.md) | JSON file format and validation rules |
| [03-build-plan.md](03-build-plan.md) | Implementation sequence |
| [04-acceptance.md](04-acceptance.md) | Exit criteria and verification |
| [05-implementation-notes.md](05-implementation-notes.md) | Final notes and verification |

## Core posture

An installed app is a versioned JSON definition bundle plus optional sample data. Native handlers
remain code and are referenced by name from the template.
