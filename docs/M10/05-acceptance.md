# 05 — Acceptance

## Demo scenario

1. Reset/seed the app (seeds `audit:policy` with a 365-day horizon).
2. `POST /api/audit/run`; confirm `recorded > 0` (the seeded business documents) and that
   `GET /api/audit` shows a `created` event for a seeded expense.
3. Tick again with no new changes; confirm `recorded: 0` (checkpoint advanced + `docId@rev` dedupe)
   and the event count is unchanged.
4. As a scoped user (Bob, `:3003`), `GET /api/audit` never shows an Alice-only document's events, while
   Bob's own readable document's events appear (audit visibility mirrors `readers`).
5. Insert an aged `auditevent` into the local replica; `POST /api/audit/run`; confirm it is pruned
   (gone from `GET /api/audit` and tombstoned in CouchDB).
6. Delete a document via the API; confirm a `deleted` event is recorded, and the runtime audit-trail
   panel renders a selected document's events.

## Exit criteria

M10 is complete when the project can prove:

- a tick records a durable, ACL-scoped event for each business create/update, including changes that
  arrived by replication;
- a repeated tick records nothing new (durable, at-least-once, deduped by `docId@rev`);
- a delete is audited (best-effort at the API delete path);
- audit visibility mirrors the source document's `readers` — a scoped user never sees an unauthorized
  document's trail;
- retention prunes events past `retentionDays` via a replicating tombstone delete (not `_purge`);
- `audit:policy` promotes via the template artifact while `auditevent:*` / `audit:state` do not;
- the pure engine is deterministic and unit-verified, with no new substrate or Mango index.
