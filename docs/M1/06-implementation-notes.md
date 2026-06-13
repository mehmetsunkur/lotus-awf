# 06 — Implementation Notes

## Runtime topology

M1 is implemented as a small CouchDB-first replica runtime:

- server CouchDB: `http://localhost:5984`
- local CouchDB: `http://localhost:5985`
- app runtime UI: `http://localhost:3000`
- app runtime API: `http://localhost:3001`

The runtime reads and writes business data only through the local CouchDB replica. Server CouchDB is
used for seeding, bidirectional replication, server-side design-document edits, and the ACL spike.

The Docker app image does not install npm dependencies inside the container because npm repeatedly
hung during image builds in this environment. Run `npm install` once on the host before starting the
Compose topology.

```bash
npm install
docker compose up -d --build
```

## Database and document conventions

The sample app database is `expense_app`.

Document IDs follow the M1 contract:

- `app:config`
- `form:expense`
- `view:my-expenses`
- `acl:rules`
- `doc:expense:<ulid>`

Business documents use a stable envelope plus schema-free `payload`. New document IDs are generated
with ULID so documents can be created offline without central coordination.

## Setup and seed commands

Use these commands against the Compose topology:

```bash
npm run reset
npm run seed
```

`reset` deletes and recreates the local and server app databases. `seed` creates them if needed and
adds the sample app/config/design/data documents.

The UI also exposes `Setup` and `Reset` buttons through the API.

## Replication setup

Replication is one-shot bidirectional CouchDB replication:

```bash
npm run replicate
```

The runtime API does the same through:

```text
POST /api/replicate
```

Replication bodies use container-reachable URLs:

```json
{
  "source": "http://admin:password@local-couchdb:5984/expense_app",
  "target": "http://admin:password@server-couchdb:5984/expense_app",
  "create_target": true
}
```

and the reverse direction for pull replication.

When scripts run from the host, they still call CouchDB through `localhost`, but the URLs embedded in
the replication body use Compose service names because CouchDB resolves those URLs from inside its
own container network.

## Metadata-driven forms and views

The runtime loads these replicated definition documents from local CouchDB:

- `form:expense` drives the edit form fields.
- `view:my-expenses` drives list columns and first-sort behavior.

The `Design Edit` UI button mutates the server copy of the form/view definitions by adding a
`merchant` field and list column. After running `Sync`, the local runtime updates from the replicated
definition documents.

## Conflict detection and resolution

Conflicts are detected with `_all_docs?include_docs=true&conflicts=true`. A document is listed as
conflicted when CouchDB returns `_conflicts` on the winning revision.

Use this command to force a conflict:

```bash
npm run force-conflict
```

The script creates a shared base revision, edits the same document independently on local and server,
then replicates both directions. The runtime can inspect the winning revision plus losing conflict
revisions via:

```text
GET /api/conflicts
GET /api/conflicts/:id
```

Manual resolution saves a new winning document revision from the selected payload and then deletes
each losing conflict revision by `_rev`:

```text
POST /api/conflicts/:id/resolve
```

This clears the conflict from the local replica. The resolved document should then be replicated so
the server receives the selected winning state.

## ACL-filtered replication spike

Run:

```bash
npm run acl-spike
```

The spike creates per-user local databases and uses selector-based replication from the server:

```json
{
  "selector": {
    "readers": {
      "$in": ["user:alice", "role:finance"]
    }
  }
}
```

Current finding: **conditional**.

Selector replication can produce different incoming document subsets for different users. In the
tested flow, removing a user's access on the server did not automatically purge a document already
present in that user's local replica. M1 should treat revocation purge as unsolved until a dedicated
cleanup/tombstone strategy is proven.

## Verification performed

The implementation was verified with:

```bash
npm run build
docker compose up -d --build
curl -sf http://localhost:3001/api/health
npm run reset
npm run replicate
npm run force-conflict
npm run acl-spike
```

The conflict API was also checked by inspecting a generated conflict and resolving it through
`POST /api/conflicts/:id/resolve`.

## Known limitations and risks

- The app runtime is a development spike, not hardened production infrastructure.
- CouchDB credentials are development-only and committed for local reproducibility.
- Replication is manual one-shot replication, not a durable background sync scheduler.
- Filtered replication currently answers only the incoming subset question; revocation purge remains
  conditional/unsolved.
- Conflict resolution keeps the winning payload chosen by the user; no automatic field merge is
  implemented.
- The UI covers one app and one document type: `expense`.
- `npm audit` reports dependency vulnerabilities from the current npm dependency tree; M1 did not
  attempt dependency hardening.
