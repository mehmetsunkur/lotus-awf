# 03 — Audit Runtime

## The tick

`runAudit()` is server-authoritative and CDC-driven, mirroring `runAgents()`:

```
POST /api/audit/run
  → load audit:policy + audit:state checkpoint
  → existing = findDocs({kind:"auditevent"})        // one read serves dedupe + retention
  → changes = changesSince(local, state.lastSeq)
  → for each business create/update not already seen (docId@rev):
        write auditevent:<ulid> { docId, docType, rev, action, actor, at, readers }
  → advance audit:state.lastSeq                      // events written BEFORE the checkpoint
  → prune: tombstone-DELETE events where eventIsExpired(event, now, policy)
```

Properties, each inherited from the M8 substrate:

1. **Offline-correct.** Because audit reads the change feed, an edit made on a device and replicated
   later is recorded when it reaches the server's replica — not only edits that hit an API write path.
2. **At-least-once + idempotent.** Events are written before the checkpoint advances, so a crash in
   between only re-drains the same change; `docId@rev` dedupe makes the replay record it once.
3. **No feedback loop.** The `auditevent`/`audit:state` writes reappear in the feed, but `shouldAudit`
   skips non-`document` kinds, so the recorder never audits itself.
4. **Serialized.** Ticks chain in-process (like agents) so overlapping calls cannot double-record or
   409 the checkpoint write.

Ticks are driven by the explicit `POST /api/audit/run`; the optional agent interval
(`AGENTS_INTERVAL_MS`) also audits on an always-on node, off by default and in tests.

## Deletes

The CDC feed has no body for a deleted document, so a delete is recorded **best-effort at the API
delete path**, where the envelope (`readers`, actor) is still in hand. A delete that arrives only via
replication (never the API path) is a documented gap.

## Retention

Expired events are pruned in the tick with a tombstone `DELETE`, which **replicates** the prune to
devices — deliberately the opposite of M5 `_purge` (a local-only revocation that must not globally
delete). New events use `now` and are never expired in the tick that creates them.

## ACL ordering and the UI

Audit events copy `readers` from the source document, and `GET /api/audit` returns only events whose
`readers` intersect the caller's principals — so the trail can only ever narrow to what the caller can
read. The runtime renders a read-only **audit-trail panel** (`data-testid="audit-trail"`) for the
selected document, fetching `GET /api/audit?docId=` from the local server on selection, beside the
workflow history.

## Scale and limits

- The recorder/pruner scan `{kind:"auditevent"}` (bounded `limit`) — no dedicated index. Fine at this
  scale; a time/doc index is the future step and would not change the contract.
- Events record the change (action + rev + actor), not a field-level before/after diff.
