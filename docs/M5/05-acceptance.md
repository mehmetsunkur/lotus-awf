# 05 — Acceptance

## Demo scenario

1. Reset/seed the app.
2. Compare Alice and Bob document lists.
3. Confirm Bob does not see Alice-only docs in lists or sourced select options.
4. Confirm Bob cannot edit/delete a document he can read but does not author.
5. Confirm Bob cannot transition a document he cannot read.
6. Revoke Bob's access to a visible server document.
7. Sync as Bob and confirm the document is removed from the local replica.

## Exit criteria

M5 is complete when the project can prove:

- reads and sourced options use one shared access predicate;
- view filters never widen access;
- payload edits/deletes enforce `authors`;
- workflow transitions require read access plus workflow guard/role success;
- pull replication is scoped by `readers`;
- revocation purge removes unauthorized local documents without deleting them on the server;
- tests cover Alice/Bob behavior.
