# 03 — Replication And Purge

> **Superseded by ADR-0026 (2026-10-19):** the per-document revocation purge and `/api/admin/revoke-reader` are removed; pull replication scopes business documents by `kind` only and revocation is an app ACL change enforced at the API gate.

## Filtered pull

M5 keeps the dual-CouchDB spike topology. Push replication remains unfiltered so local edits can move
upward. Pull replication is split into:

- design/app metadata needed by the runtime;
- business documents whose `readers` match the current actor's principal set.

## Revocation purge

Selector replication does not remove documents that were replicated before access was revoked. After
sync, M5 scans local business documents and purges local revisions the actor can no longer read.

The purge is local-only and deliberately does not create a normal delete tombstone. A normal delete
could replicate upward and delete the server's authoritative document for everyone, which would be
incorrect for access revocation.

## Remaining gap

The purge protects the runtime's local replica shape in this spike. It is not a replacement for a
production sync gateway or server-side authorization boundary.
