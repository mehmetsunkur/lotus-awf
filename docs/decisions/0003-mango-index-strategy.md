# ADR-0003: Mango index strategy for views

Date: 2026-06-14

## Status

Accepted

## Context

Views translate `sort`/`filters` into CouchDB Mango selectors. Sorting by `updatedAt` requires a
matching Mango index, and queries must remain correct as new views are added.

## Taxonomy

- Subsystem: Server
- Domain Area: Query & indexing
- Risk Class: Performance
- Runtime Surface: Internal API

## Decision

Maintain two named Mango indexes — `m2-kind-docType-updatedAt` (`["kind","docType","updatedAt"]`)
and `m2-readers` (`["readers"]`). `GET /api/views/:id/documents` builds the selector from the view
and sets `use_index: "m2-kind-docType-updatedAt"` when sorting by `updatedAt`.

## Alternatives Considered

1. No indexes / full scans (rejected: incorrect/slow sorts).
2. One index per view (rejected: premature; current views share two).
3. Two shared indexes covering current views (chosen).

## Consequences

- Positive: correct, indexed `updatedAt` sort; minimal index surface.
- Negative — known debt: the index definitions are duplicated in **three** places
  (`scripts/seed.ts`, `scripts/reset.ts`, and `seedTarget` in `src/server/index.ts`). Adding or
  changing an index must update all three (**Index & query** invariant). A new view sort/filter
  field may require a new index.

## Follow-Ups

- Consider extracting a single index-definition source consumed by all three seeders to remove the
  triplication.
