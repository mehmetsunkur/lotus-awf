# 05 — Build sequence (spike-first)

The discipline: **de-risk the hardest unknown before committing**, exactly as a storage spike should
precede a workflow engine. Here the hardest unknown is the **sync substrate**.

## Spike 0 (blocking) — the sync substrate go/no-go

**Question to answer:** can the chosen substrate do **ACL-scoped partial sync** *and* **sane conflict
resolution** for our document + workflow shape, offline, at a realistic scale?

- **Candidates:** PowerSync (Postgres⇄SQLite) vs Couchbase (Lite + Sync Gateway). Run both if
  affordable.
- **Setup:** the envelope+payload document model; N users, partial replication scoped by ACL; a
  realistic dataset (e.g. 100k docs, only a few thousand visible per user).
- **Scenarios that must pass:**
  1. Create + edit documents fully offline; sync without loss.
  2. **Two devices edit the same document's different fields offline** → merge cleanly.
  3. **Two devices edit the same field offline** → deterministic resolution + a surfaced conflict.
  4. **A device advances workflow state offline** → server reconciles via engine rules (or rejects
     cleanly) on sync.
  5. **ACL change** (user loses access) → the doc *leaves* that device's replica on next sync.
  6. Offline-created docs get **client UUIDs**; human-readable numbers allocated on first sync with
     no collisions across devices.
- **Capture:** sync latency, payload/delta sizes, conflict-handling behaviour, partial-sync
  correctness (no leakage of unauthorized docs), behaviour at deep offline (days disconnected).
- **Exit:** **PASS** (substrate handles partial sync + conflicts → proceed, record the winner and
  resolve Q-2/Q-6) · **CONDITIONAL** (works with a documented constraint, e.g. transitions must be
  online → that *is* Option B) · **FAIL** (neither substrate serves it → reconsider scope or
  substrate). **Do not build the engine before this passes.**

## Phase 1 — Local-first data foundation
- Local replica + bidirectional sync wired end-to-end.
- Offline-safe identity (UUIDv7/ULID) + lazy server-side numbering.
- The envelope+payload schema on the server (Postgres) and on the device (SQLite/Pouch).
- **Exit:** a document round-trips create→offline-edit→sync→reconcile on two devices.

## Phase 2 — Portable expression engine
- One sandboxed dialect (CEL or JS-sandbox) running identically on client, server, replica.
- Server remains authoritative; client mirror drives live UX.
- **Exit:** the same rule (e.g. `hide unless payload.amount > 1000`) evaluates identically offline
  and on the server.

## Phase 3 — Form runtime (offline)
- Form-schema model + React renderer reading the **local replica**.
- Computed fields, hide-when, validation — all offline via the Phase-2 engine.
- **Exit:** a multi-field form with conditional logic is filled and validated fully offline.

## Phase 4 — View / list runtime (offline)
- Metadata-driven list definitions → query over the local replica → data grid.
- Sort/filter on typed envelope columns; ACL-scoped.
- **Exit:** a worklist renders, sorts, and filters offline, showing only authorized docs.

## Phase 5 — Workflow engine
- Server-authoritative transitions + reconciliation (Option B).
- Decide Q-1: if Option A, push the portable engine to the device for optimistic transitions.
- **Exit:** a document advances through multiple states with validation, history, and events;
  offline transitions (if A) reconcile on sync.

## Phase 6 — Conflict-resolution UX
- The Notes-style "replication conflict" surface for what auto-merge can't settle.
- **Exit:** a human can review and resolve a genuine field-level conflict.

## Phase 7 — Security → partial-sync
- Per-document ACL (OpenFGA/RLS) generating the partial-replication rules.
- Revocation that removes docs from a device on sync.
- **Exit:** access policy and sync scope provably share one source of truth.

## Phase 8 — Dual authoring
- **Citizen:** low-code studio (start schema-driven, then drag-and-drop) writing definitions.
- **Developer:** definitions-as-code SDK/CLI + plugin SDK; the two interoperate.
- **Exit:** a power-user builds an app; a developer adds one plugin it calls.

## Phase 9 — Promotion, agents, search, hardening
- Versioned templates + extract/apply/diff/promote (the `.ntf` analog).
- Scheduled + event-triggered agents (Temporal + CDC).
- Full-text search (server + offline-on-device).
- Observability, HA, audit/retention, perf & index review.
- **Exit:** the north-star scenario (00-vision §Success criteria) runs end-to-end.

## Parallelisation
Once Phase 1 (data foundation) lands, streams can run in parallel: **engine/platform**, **authoring
studio** (the critical path — start early), **sync/storage ops**, **security**, **client/UX**. The
authoring experience is the most likely to slip — give it dedicated capacity from the start.
