# 01 — Scope

## M10 objective

Establish an audit & retention foundation: a server-authoritative recorder writes a durable,
ACL-scoped trail of business-document changes from the change feed, and a retention policy prunes
events past a horizon.

## The recorder model (key decision)

Audit is **CDC-driven and server-authoritative**, mirroring the M8 agent runtime. `runAudit()` drains
`_changes` since an `audit:state` checkpoint and records an `auditevent:*` per business create/update,
deduped by `docId@rev`. Driving it off the change feed (not only the synchronous write path) is what
makes it correct offline: an edit made on a device and replicated later is audited when it reaches the
server's replica. Deletes are recorded best-effort at the API delete path, where the envelope is still
available. See `docs/decisions/0005-audit-via-cdc-and-tombstone-retention.md`.

What is audited and how long it is kept is **data**, consistent with definitions-as-data: a singleton
`audit:policy` design document.

## In scope

- A pure engine in `src/shared/audit.ts`: `auditAction`, `shouldAudit`, `eventIsExpired`.
- `audit:policy` (design data, templated like `acl:rules`): `retentionDays` + optional `docTypes`
  allowlist, validated by the shared definition validator.
- `auditevent:*` + `audit:state` runtime documents (never templated).
- A server-authoritative `runAudit()` tick: CDC drain → record create/update → advance checkpoint →
  prune expired events via tombstone `DELETE`.
- Delete auditing best-effort at the API delete path.
- `POST /api/audit/run`, `GET /api/audit` (principal-scoped, `?docId`/`?docType`).
- A read-only audit-trail panel in the runtime UI.

## Out of scope

- Distributed/HA scheduling — single-node, same as M8.
- A dedicated audit index, inverted index, or external log store (events scan the kind-leading index).
- Auditing deletes that arrive only via replication (the feed has no deleted body — API-path only).
- Field-level diffs / before-after payload capture (the event records the change, not the delta).
- Studio editing of `audit:policy` (seed/template-managed, like `acl:rules`).
- Tamper-evidence / signing, export, or compliance reporting.
- Production authorization for the endpoints (same non-production posture as M4–M9).

## Product framing

M10 is the Notes change-history analog re-centered on offline-first and ACL: every business-document
change a user makes — online or replicated from the field — is recorded server-authoritatively,
visible only to those who can read the document, and aged out by a policy a citizen sets as data.
