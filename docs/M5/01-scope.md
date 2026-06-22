# 01 — Scope

## M5 objective

M5 makes access policy explicit and consistently enforced by the runtime API. A user should only see,
select, edit, or transition business documents allowed by a shared readers/authors policy. When access
is revoked on the server, a sync pass removes the now-unauthorized document from the local replica.

## In scope

- Shared access helpers over actor principals and document `readers`/`authors`. Originally this was
  `{ user, roles }`; M18 replaces it with session-derived `person:*` and `group:*` principals.
- Scoped runtime list queries, document queries, and sourced select options.
- Payload edit/delete checks using `authors`.
- Workflow transition read checks plus existing transition role/guard checks.
- Selector-scoped pull replication for business documents.
- Local revocation purge after sync.
- Multi-user e2e/API coverage using the existing Alice/Bob API processes.

## Out of scope

- Production authentication or hostile-client hardening.
- Per-user local database topology.
- CouchDB users, per-doc CouchDB auth, or Sync Gateway/OpenFGA integration.
- Signed offline writes.
- Per-role definition visibility.

## Security posture

M5 hardens the app/API path in the existing development topology. It does not claim that a malicious
local actor with direct CouchDB admin credentials cannot tamper with data. Production security still
requires a sync boundary that validates writes and credentials outside this local spike.
