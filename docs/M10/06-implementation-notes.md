# 06 — Implementation Notes

## Implemented runtime behavior

M10 adds a server-authoritative, CDC-driven audit trail with retention:

- a pure engine (`src/shared/audit.ts`) — `auditAction`, `shouldAudit` (business docs only; skips the
  audit/agent runtime kinds so the recorder never audits itself), `eventIsExpired`;
- `runAudit()` drains `_changes` since `audit:state`, writes durable `auditevent:*` for business
  create/update (deduped by `docId@rev`), advances the checkpoint, then prunes expired events via
  tombstone `DELETE`;
- deletes are recorded best-effort at the API delete path (the feed has no deleted body);
- `audit:policy` is design data, validated by the shared validator and carried in templates like
  `acl:rules`; seeded with `retentionDays: 365`;
- `POST /api/audit/run` and `GET /api/audit` (principal-scoped); the optional agent interval also
  audits, off by default;
- a read-only audit-trail panel renders the selected document's events.

## Architecture

Matching/expiry is pure and portable (`src/shared/audit.ts`), unit-tested, exactly like the agent and
workflow engines. The server orchestrates the I/O (the `_changes` feed, the durable store, the clock,
the prune) around it. The recorder reuses the M8 CDC mechanism with its own `audit:state` checkpoint,
independent of the agent checkpoint.

## ACL, durability, correctness

Events copy `readers` from the source document, and `GET /api/audit` filters by the caller's
principals — audit visibility mirrors document visibility and can only narrow. Events are written
before the checkpoint advances; a replay re-records nothing (docId@rev dedupe). Ticks are serialized
in-process. The `auditevent`/`audit:state` writes reappear in the feed but are skipped
(`kind !== "document"`) — no feedback loop. Retention is a replicating tombstone delete, deliberately
distinct from M5 `_purge` revocation.

## Verification performed

```bash
npm run build                                  # tsc --noEmit + vite build
npm run test:unit                              # audit engine + policy validation
npx playwright test tests/e2e/audit.spec.ts    # record/idempotent, ACL, retention, delete + panel
npm run test:e2e                               # full suite
```

## Known limitations and risks

- Single-node only; the recorder/pruner scan `{kind:"auditevent"}` (bounded `limit`) with no dedicated
  index — a candidate for a time/doc index under load.
- A delete that arrives only via replication (never the API path) is not audited (the feed has no
  deleted body).
- Events record the change (action/rev/actor), not a field-level before/after diff.
- `audit:policy` is seed/template-managed, not yet studio-editable.
- `GET /api/audit` is principal-scoped (stricter than M8's unfiltered `GET /api/agents/runs`).
