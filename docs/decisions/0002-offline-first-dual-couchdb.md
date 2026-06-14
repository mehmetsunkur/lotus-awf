# ADR-0002: Offline-first with dual CouchDB replicas

Date: 2026-06-14

## Status

Accepted

## Context

The product is Notes-like: users must create and edit while offline, then sync later, and inspect
conflicts on both business data and app definitions. This requires a local store that works with no
server round-trip and a server store to sync against.

## Taxonomy

- Subsystem: Server, Client
- Domain Area: Offline-first, Replication & conflict
- Risk Class: Availability, Data integrity
- Runtime Surface: Internal API, Web UI

## Decision

Run two CouchDB instances — a **local** replica (`:5985`) the app reads/writes directly, and a
**server** replica (`:5984`) it replicates against bidirectionally. All create/edit/validate/list
operations target the local replica so they work offline; `POST /api/replicate` performs
push/pull; conflicts are surfaced and resolved through the API/UI.

## Alternatives Considered

1. Single server database (rejected: no offline).
2. Local-only with manual export (rejected: no real sync/conflict model).
3. Dual CouchDB with bidirectional replication (chosen — CouchDB gives replication/conflict for free).

## Consequences

- Positive: genuine offline editing; CouchDB handles replication and conflict surfacing.
- Negative: every code path must respect the local-first rule (**Offline editing** invariant); a
  new server dependency on an offline path is a regression. Conflict handling must preserve
  `_rev`/`_conflicts` (**Replication & conflict** invariant).

## Follow-Ups

- e2e coverage for offline/replication-conflict flows needs container stop/start orchestration
  (deferred `@infra` suite — see `tests/e2e/README.md`).
