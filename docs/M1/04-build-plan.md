# 04 — Build Plan

## Step 1 — Local/server CouchDB environment

Create a reproducible development topology.

Expected command shape:

```text
docker compose up
```

Minimum services:

- server CouchDB;
- local CouchDB;
- app runtime.

Exit when both CouchDB instances are reachable and the sample app database can be created.

## Step 2 — Seed one app database

Seed a simple expense app:

- `app:config`;
- `form:expense`;
- `view:my-expenses`;
- a few `doc:expense:*` documents.

Exit when the same database can exist on local and server CouchDB.

## Step 3 — Prove bidirectional replication manually

Create and edit documents on one side, replicate, and verify they appear on the other side.

Scenarios:

- local create -> server receives;
- server create -> local receives;
- local edit while server is unavailable -> sync later;
- delete handling via CouchDB `_deleted`.

Exit when basic replication behavior is understood and documented.

## Step 4 — Build minimal app runtime

The runtime connects to local CouchDB only.

It should support:

- list documents;
- create expense document;
- edit expense document;
- save locally;
- show connection/replication status.

Exit when the app remains useful while server CouchDB is stopped.

## Step 5 — Render replicated form and view definitions

Replace hard-coded fields and columns with local definition documents:

- `form:expense` drives the edit form;
- `view:my-expenses` drives the list columns.

Exit when editing the form/view definition on the server replicates locally and changes the runtime.

## Step 6 — Conflict demo

Force a conflict:

- device/local A edits a document offline;
- device/local B or server edits the same document independently;
- sync both;
- verify CouchDB stores a conflict.

Exit when the runtime shows the conflict and allows the user to inspect competing revisions.

## Step 7 — Manual conflict resolution

Add the simplest resolution flow:

- user chooses or edits a winning value;
- runtime saves a new document revision;
- old conflicting revisions are handled according to the documented CouchDB cleanup approach.

Exit when a conflict can move from visible to resolved.

## Step 8 — ACL-filtered replication spike

Test partial replication with at least two users.

Questions:

- can server-side filters restrict documents by `readers`;
- can different users receive different document subsets;
- what happens when a user loses access;
- can revoked documents be removed from local CouchDB on next sync;
- what limitations remain because data was already replicated.

Exit with a clear pass/conditional/fail note for CouchDB-first ACL-scoped replication.

