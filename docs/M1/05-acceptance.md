# 05 — Acceptance

## Demo scenario

M1 should demonstrate this flow:

1. Start local CouchDB, server CouchDB, and the app runtime.
2. Open the expense app.
3. Create an expense document while connected.
4. Stop or disconnect the server.
5. Create and edit expense documents locally.
6. Restart or reconnect the server.
7. Replicate local changes to the server.
8. Verify server-created changes replicate back to local.
9. Change a form or view definition on the server.
10. Verify the local runtime updates after replication.
11. Force a document conflict.
12. Inspect and manually resolve the conflict.
13. Run the ACL-filtered replication spike for two users.

## Exit criteria

M1 is complete when the project can prove:

- local-first create/edit with no server connection;
- bidirectional CouchDB replication;
- app definitions replicate alongside business data;
- simple metadata-driven form rendering;
- simple metadata-driven view/list rendering;
- conflict detection;
- manual conflict inspection and resolution path;
- initial answer on ACL-filtered replication feasibility.

## Required written outcomes

The implementation should leave behind short notes covering:

- CouchDB database naming and document ID conventions;
- exact replication setup used;
- how conflicts are detected;
- how conflicts are resolved or cleared;
- filtered replication findings;
- known limitations and risks.

## Go/no-go decision after M1

After M1, decide whether CouchDB remains the base replica substrate.

Outcomes:

- **Go:** CouchDB supports the modern NSF-like replica well enough; continue with richer forms,
  views, templates, security hardening, and later workflow.
- **Conditional:** CouchDB works but with documented constraints, especially around partial
  replication or revocation.
- **No-go:** authorization, conflict handling, or operational constraints are too severe; revisit
  the sync substrate before building higher layers.

