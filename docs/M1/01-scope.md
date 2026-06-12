# 01 — Scope

## M1 objective

M1 establishes a small, working replicated application database:

- one app is represented as one CouchDB database;
- data documents and app-definition documents live together;
- each user/device works against a local CouchDB replica;
- replication syncs local CouchDB with server CouchDB;
- the app runtime reads only from the local replica.

The milestone is successful when a simple app can run while disconnected, sync later, and preserve
conflicts instead of losing data.

## In scope

- Local CouchDB and server CouchDB topology.
- One sample app database.
- Business documents with a consistent envelope and schema-free payload.
- Client-generated document IDs.
- Bidirectional replication.
- Simple metadata-driven form definitions.
- Simple metadata-driven view/list definitions.
- A minimal local app runtime that can list, create, edit, and save documents.
- Replication status visibility.
- Conflict detection and manual conflict inspection.
- Basic manual conflict resolution path.
- ACL-filtered replication spike.

## Out of scope

- Workflow engine.
- Agents and scheduled automation.
- Full low-code studio.
- Production-grade template promotion.
- Full-text search beyond what is needed for the demo.
- Attachments, unless needed to validate a CouchDB replication assumption.
- Complex relational reporting.
- Native packaging or embedded CouchDB distribution.

## Product framing

M1 is not a complete app platform. It is the substrate test.

The working question is:

> Can a CouchDB-first replica behave like the modern replacement for an NSF file?

If the answer is yes, later milestones can add workflow, agents, authoring tools, security hardening,
and promotion.

