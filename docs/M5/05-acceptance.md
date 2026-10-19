# 05 — Acceptance

> **Amended by ADR-0026 (2026-10-19):** per-document `readers` were removed — document visibility is the app ACL. Criteria below are restated accordingly; the original readers-based wording is history.

## Demo scenario

1. Reset/seed the app.
2. Compare Alice and Bob document lists — as app members both see every document (ADR-0026).
3. Remove Bob from the app ACL and confirm lists, sourced options, reads and audit refuse him.
4. Confirm Bob cannot edit/delete a document he can read but does not author, and cannot
   edit even his own document once demoted to Reader.
5. Confirm Bob cannot transition a document in an app he has no access to.
6. (Superseded by ADR-0026: per-document revocation and the sync purge were removed —
   revocation is an app ACL change enforced at the API gate.)

## Exit criteria

M5 is complete when the project can prove:

- reads and sourced options use one gate — the app ACL (ADR-0026);
- view filters never widen access;
- payload edits/deletes enforce app Author+ plus `authors` (or Editor+);
- workflow transitions require app access plus workflow guard/role success;
- (superseded by ADR-0026) ~~pull replication is scoped by `readers`~~ — pull scopes business
  docs by `kind`;
- (superseded by ADR-0026) ~~revocation purge removes unauthorized local documents~~ — removed;
- tests cover Alice/Bob behavior.
