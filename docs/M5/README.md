# M5 — Security and Partial Replication Hardening

M5 hardens the spike-level ACL model enough that runtime/API paths use one access predicate and
revoked documents leave the local replica after sync.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary and non-production assumptions |
| [02-access-policy.md](02-access-policy.md) | Shared readers/authors policy |
| [03-replication-purge.md](03-replication-purge.md) | Filtered pull and local revocation purge model |
| [04-build-plan.md](04-build-plan.md) | Implementation steps |
| [05-acceptance.md](05-acceptance.md) | Demo flow and exit criteria |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |
