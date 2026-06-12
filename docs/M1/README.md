# M1 — CouchDB Replica Milestone

M1 proves the first real foundation of the platform: a Lotus Notes-style replicated application
database built on CouchDB-compatible replication.

This milestone deliberately does **not** implement the workflow engine. Workflow, agents, richer
authoring, and promotion all become later layers once the replica substrate is proven.

## Goal

Build a minimal modern NSF-like replica:

- create, edit, and read documents locally;
- replicate bidirectionally with a server CouchDB;
- store app definitions alongside data;
- render simple forms and views from those replicated definitions;
- detect and expose conflicts;
- spike ACL-filtered replication.

## Documents

| Doc | Purpose |
|-----|---------|
| [01-scope.md](01-scope.md) | What M1 includes and excludes |
| [02-architecture.md](02-architecture.md) | CouchDB-first local/server replica architecture |
| [03-data-contract.md](03-data-contract.md) | App/database unit, document envelope, form/view definitions |
| [04-build-plan.md](04-build-plan.md) | Suggested implementation order |
| [05-acceptance.md](05-acceptance.md) | Demo scenarios and exit criteria |

## Core posture

The project is replication-first for M1:

> First build the modern NSF/replica substrate. Then build workflow, agents, templates, and richer
> authoring on top of it.

The key technical bet is that CouchDB can provide the base replication model closely enough to Lotus
Notes to avoid inventing a custom sync layer at the start.

