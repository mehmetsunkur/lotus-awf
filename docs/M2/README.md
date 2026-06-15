# M2 — Metadata-Driven Local Runtime

M2 builds on the M1 CouchDB replica substrate by making replicated app definitions meaningfully drive
the local runtime.

M1 proved that documents, form definitions, view definitions, replication, conflicts, and an ACL
spike can exist in one CouchDB-style app database. M2 proves that those definitions can become a
useful offline application runtime foundation before workflow is introduced.

## Goal

Build a richer metadata-driven local app runtime:

- render richer replicated form definitions;
- validate documents locally from shared rules;
- evaluate simple portable expressions offline;
- support multiple document types in one app database;
- render multiple replicated views with filters and sorts;
- edit definition documents locally through a JSON editor;
- query business documents through CouchDB indexes;
- surface and resolve conflicts on data and definition documents.

## Documents

| Doc | Purpose |
|-----|---------|
| [01-scope.md](01-scope.md) | What M2 includes and excludes |
| [02-data-contract.md](02-data-contract.md) | M2 form/view/document contract extensions |
| [03-expression-runtime.md](03-expression-runtime.md) | Expression and validation runtime decisions |
| [04-build-plan.md](04-build-plan.md) | Suggested implementation order |
| [05-acceptance.md](05-acceptance.md) | Demo scenarios and exit criteria |
| [06-implementation-notes.md](06-implementation-notes.md) | Implemented M2 behavior, verification, and limitations |

## Core posture

M2 deliberately still avoids workflow.

The working question is:

> Can replicated definitions drive enough local runtime behavior to justify building workflow on top?
