# ADR-0001: Definitions-as-data runtime

Date: 2026-06-14

## Status

Accepted

## Context

M2 needs forms, views, and validation to be changeable while offline and to replicate like any
other document. Hard-coding form/view structure in the client would make the runtime un-editable
without a redeploy and would not survive replication/conflict like business data.

## Taxonomy

- Subsystem: Shared, Server, Client
- Domain Area: Definitions-as-data
- Risk Class: Contract / back-compat
- Runtime Surface: Web UI, Internal API

## Decision

Form and view definitions are stored as ordinary CouchDB documents (`form:*`, `view:*`) whose
TypeScript shape lives in `src/shared/types.ts`. The client and API both read these documents at
runtime to drive rendering, validation, and queries. Definitions replicate, version, and conflict
exactly like business documents.

## Alternatives Considered

1. Hard-coded forms/views in the client (rejected: not editable offline, no replication).
2. Server-rendered forms (rejected: breaks the offline-first requirement).
3. Definitions-as-data (chosen).

## Consequences

- Positive: offline-editable runtime; uniform replication/conflict model; the substrate for the
  future builder.
- Negative: definition shape changes can strand documents already replicated to clients — see the
  **Definitions-as-data contract & back-compat** invariant; back-compat must be handled explicitly.

## Follow-Ups

- Keep `docs/M2/02-data-contract.md` authoritative for the definition shape.
- A schema guard for `form:*`/`view:*` documents would make malformed definitions fail loudly.
