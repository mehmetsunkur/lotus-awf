# ADR-0004: Full-text search as a shared matcher over ACL-scoped candidates

Date: 2026-06-16

## Status

Accepted

## Context

The vision (Phase 9) calls for full-text search that works **server-side and offline-on-device**.
In this codebase the "device/offline" tier is the **local CouchDB node** read through the local
Express server (there is no in-browser DB / PouchDB), and the query layer is **CouchDB Mango**
(`_find`). Mango has no real full-text search — only `$regex` (unindexed scan, case/accent
sensitive, no ranking) — and CouchDB 3.x ships no built-in Lucene. Adding a search engine
(Couchbase, couchdb-lucene/nouveau, or an in-browser FTS index) would introduce new substrate and
break the simple dual-CouchDB posture proved in M1–M8.

## Taxonomy

- Subsystem: Shared + Server
- Domain Area: Query & indexing
- Risk Class: ACL / correctness, Performance
- Runtime Surface: Internal API

## Decision

Implement search as a **pure, portable matcher** in `src/shared/search.ts` (accent-folded,
case-insensitive, AND-of-terms, prefix match, ranked by field-weighted hit count), applied by the
server **after** the existing ACL-scoped `findDocs` + `canReadDocument` filter on
`GET /api/views/:id/documents?q=`. Because the matcher is the same pure code everywhere, search
behaves identically on the server node and the local replica, satisfying "server + offline-on-device"
by construction — exactly the workflow (M3) / agents (M8) shape of "pure decision in `shared`, server
orchestrates I/O." What is searchable is **data**: an optional `searchable?: boolean` on `FormField`
(text-ish fields default on). No new Mango index is introduced; the matcher runs in-memory over the
candidate set the view query already returns.

## Alternatives Considered

1. **Mango `$regex`** (rejected as primary): unindexed scan, accent/case sensitive, no ranking, and
   text matching still leaks into selector logic that must stay ACL-correct.
2. **CouchDB Lucene / nouveau / Couchbase** (rejected for M9): new substrate, new ops surface,
   contradicts the dual-CouchDB go/no-go already settled; revisit only if scale demands it.
3. **In-browser FTS index (lunr/minisearch over PouchDB)** (rejected): there is no in-browser replica
   to index; "device" here is the local CouchDB node. A browser DB is a separate, larger change.
4. **Shared matcher over ACL-scoped candidates (chosen)**: no new infra, portable by construction,
   ACL-safe because it only narrows an already-filtered set.

## Consequences

- Positive: identical offline/server behavior with zero new infrastructure; ACL-narrowing is
  structural (search runs on `readable`, never widens it); semantics are deterministic and
  unit-testable in `src/shared`.
- Negative — known debt: the matcher scans the candidate set the view returns (currently capped at
  `limit: 200`); there is no inverted index, so very large result sets are not yet covered. A future
  step can derive a `searchTokens` envelope field on write + a Mango prefilter without changing the
  matcher contract.

## Follow-Ups

- Optional `searchTokens` envelope field + Mango prefilter for scale.
- A global cross-view `GET /api/search?q=` (M9 scopes search within a single view).
- Snippets / match highlighting in the runtime UI.
