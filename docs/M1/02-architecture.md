# 02 — Architecture

## Baseline topology

```text
Developer / user machine
  Local CouchDB
    app database replica

  App runtime
    reads local CouchDB
    writes local CouchDB
    renders forms/views from local definition docs
    shows replication and conflict state

Server
  Server CouchDB
    authoritative shared app database

  Optional platform services
    auth / policy layer
    seed scripts
    later workflow / agents
```

## Replication model

M1 uses CouchDB bidirectional replication:

```text
local app db <-> server app db
```

The app runtime must not depend on the server for normal document read/write. A user should be able
to create and edit documents while disconnected, then sync later.

## App/database unit

Recommended starting rule:

```text
one app = one CouchDB database
```

The database contains:

- business data documents;
- form definitions;
- view/list definitions;
- app metadata;
- ACL/policy metadata for the replication spike.

This keeps the model close to Lotus Notes: data and design live together and replicate together.

## Runtime responsibilities

The M1 app runtime should:

- connect to local CouchDB;
- list documents from local replica;
- create documents locally;
- edit documents locally;
- read form definitions from local CouchDB;
- read view definitions from local CouchDB;
- display replication status;
- display documents with conflicts;
- allow inspection of conflicting revisions.

## Server responsibilities

For M1, the server mostly hosts CouchDB and supports replication.

It may also provide:

- seed data;
- user databases or credentials;
- filtered replication experiments;
- simple policy documents.

It should not host business workflow logic in M1.

## Main risk

CouchDB handles replication well, but authorization and partial replication remain the hardest part.
M1 must explicitly test whether a user can replicate only authorized documents and what happens when
authorization changes after a document has already reached a local replica.

