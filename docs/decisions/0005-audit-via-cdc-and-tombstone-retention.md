# ADR-0005: Audit via a CDC recorder, retention via tombstone delete

Date: 2026-06-16

## Status

Accepted

## Context

The vision's Phase 9 hardening bundle calls for **audit/retention**. We want a durable, queryable
trail of document changes (who/what/when) that is correct under offline-first — including edits made
on a device and later replicated — and a retention policy that ages events out. The platform already
has the pieces: M8 proved a server-authoritative, tick-driven CDC consumer (`runAgents` drains
`_changes` against a checkpoint and writes durable runtime docs), and M5 established two distinct
deletion shapes (`_purge` for revocation vs. a replicating tombstone `DELETE`).

## Taxonomy

- Subsystem: Server + Shared
- Domain Area: Replication / CDC, ACL, retention
- Risk Class: ACL / correctness, Replication
- Runtime Surface: Internal API

## Decision

Record audit events with a **CDC recorder** that mirrors the agent runtime: `runAudit()` drains
`_changes` since an `audit:state` checkpoint and writes a durable `auditevent:*` per business-document
**create/update**, deduped by `docId@rev` (at-least-once), serialized in-process. Driving it off the
change feed (not the synchronous write path) is what makes it correct offline — an edit replicated
from a device is audited when it reaches the server's replica, even though it never hit an API write
path. The agent-handler contract is left untouched (handlers still do not write documents); audit is
its own subsystem.

**Deletes** are recorded best-effort at the API delete path, where the envelope (`readers`, actor) is
still available — the CDC feed has no body for a deleted document.

**What is audited is data**: a singleton `audit:policy` design document (`retentionDays`, optional
`docTypes` allowlist), templated like `acl:rules`. The pure decisions — `auditAction`, `shouldAudit`,
`eventIsExpired` — live in `src/shared/audit.ts`.

**Retention** prunes events past `retentionDays` in the tick via a **tombstone `DELETE`**, which
replicates the prune to devices — deliberately the opposite of M5 `_purge` (a local-only revocation
that must *not* globally delete). Audit visibility mirrors the source document's `readers`, and
`GET /api/audit` filters by the caller's principals.

## Alternatives Considered

1. **Synchronous audit at the write path only** (rejected): misses offline edits replicated from a
   device — the offline-first case audit most needs to cover.
2. **Audit as a built-in agent** (rejected for M10): would require widening the M8 agent-handler
   contract to let handlers write documents, a larger blast radius than a dedicated recorder.
3. **`_purge` for retention** (rejected): purge is local-only and is the revocation shape; retention
   wants the prune to replicate, so a tombstone delete is correct.
4. **CDC recorder + tombstone retention + policy-as-data (chosen)**: reuses the proven M8 substrate,
   offline-correct, ACL-safe, no new infrastructure or Mango index.

## Consequences

- Positive: offline-correct audit with zero new infrastructure; ACL-narrowing is structural (events
  copy `readers`); idempotent (docId@rev dedupe); deterministic, unit-tested pure decisions; retention
  prune replicates.
- Negative — known debt: the recorder/pruner scan `{kind:"auditevent"}` (bounded `limit`) with no
  dedicated index; a delete that arrives only via replication (never the API path) is not audited;
  `audit:policy` is seed/template-managed, not yet studio-editable.

## Follow-Ups

- A dedicated time/doc index if audit volume grows.
- Audit replicated-from-device deletes (needs a pre-delete envelope snapshot or a deletion-marker
  convention).
- Studio editing of `audit:policy`.
