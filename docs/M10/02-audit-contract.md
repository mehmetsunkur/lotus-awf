# 02 — Audit Contract

## Policy (definitions-as-data)

```ts
type AuditPolicy = {
  _id: "audit:policy";
  kind: "auditpolicy";
  appId: string;
  retentionDays: number;   // events older than this are pruned on a tick
  docTypes?: string[];     // when set, only these business types are audited; absent = all
};
```

`audit:policy` is a **design document**: it replicates and is carried in template export/diff/apply
alongside `app:config`, `acl:rules`, and the form/view/workflow/agent definitions. Like `acl:rules` it
is seed/template-managed, not edited through the studio in M10. The shared definition validator rejects
a non-positive `retentionDays` or a malformed `docTypes`.

## Runtime documents (never templated)

- **`auditevent:<ulid>`** — one recorded change: `appId`, `docId`, `docType`, `rev`, `action`
  (`created`|`updated`|`deleted`), `actor`, `at`, and `readers` (copied from the source document).
- **`audit:state`** — the singleton checkpoint: the `_changes` `lastSeq` cursor for the audit drain
  (independent of the agent checkpoint).

Both are runtime data (`kind: "auditevent"` / `"auditstate"`) — excluded from `currentDefinitions`, so
they never enter a template, and absent from business/view queries (which select by kind).

## Pure engine (`src/shared/audit.ts`)

Deterministic and portable, like the agent engine:

- `auditAction(rev, deleted)` — `deleted` → `deleted`; a first-generation rev (`1-…`) → `created`;
  otherwise `updated`.
- `shouldAudit(doc, policy)` — only `kind: "document"` business docs; skips the audit/agent runtime
  kinds (so the recorder never audits its own writes — no feedback loop); honors the `docTypes`
  allowlist when set.
- `eventIsExpired(event, now, policy)` — true once the event is older than `retentionDays`. With no
  policy or a non-positive horizon, retention is disabled (an absent policy never silently deletes).

## Query API

```
POST /api/audit/run                       → { ok, recorded, pruned }
GET  /api/audit?docId=&docType=&limit=    → AuditEvent[]  (principal-scoped, newest first)
```

`GET /api/audit` returns only events whose `readers` intersect the caller's principals — audit
visibility mirrors document visibility. Both read the **local** replica, so the path stays
offline-safe.

## Invariants honored

- **ACL / readers**: events copy the source document's `readers`; `GET /api/audit` filters by principal.
- **Replication & conflict**: retention uses a replicating tombstone `DELETE`, distinct from M5 `_purge`.
- **Index & query**: no new Mango index; `{kind:"auditevent"}` binds the kind-leading index.
- **Definitions-as-data contract**: `AuditPolicy` is new; no existing shape changed.
- **Offline editing**: the recorder and `GET /api/audit` read the local node; no server round-trip.
