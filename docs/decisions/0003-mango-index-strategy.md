# ADR-0003: Mango index strategy for views

Date: 2026-06-14

## Status

Accepted

**Amended by ADR-0026** (2026-10-19): the `m2-readers` index is removed (documents carry no `readers`); the remaining indexes are `m2-kind-docType-updatedAt` and `m3-docType-state-updatedAt`.

## Context

Views translate `sort`/`filters` into CouchDB Mango selectors. Sorting by `updatedAt` requires a
matching Mango index, and queries must remain correct as new views are added.

## Taxonomy

- Subsystem: Server
- Domain Area: Query & indexing
- Risk Class: Performance
- Runtime Surface: Internal API

## Decision

Maintain named Mango indexes — `m2-kind-docType-updatedAt` (`["kind","docType","updatedAt"]`),
`m2-readers` (`["readers"]`), and (M3) `m3-docType-state-updatedAt` (`["docType","state","updatedAt"]`)
for state-filtered worklists. `GET /api/views/:id/documents` builds the selector from the view and,
when sorting by `updatedAt`, sets `use_index` to `m3-docType-state-updatedAt` for views that filter on
`state` and `m2-kind-docType-updatedAt` otherwise.

`createIndex` pins the design-doc id to the index name (`ddoc === name`). CouchDB resolves a string
`use_index` as a ddoc id, so without this the auto-generated hashed ddoc meant the hint never bound and
selection silently fell back to auto/scan. With `ddoc === name` the hint resolves and binds (M3).

## Alternatives Considered

1. No indexes / full scans (rejected: incorrect/slow sorts).
2. One index per view (rejected: premature; current views share a small set).
3. A small set of shared indexes covering current views (chosen).
4. Leaving the hashed `ddoc` and relying on CouchDB auto-selection (rejected in M3: the `use_index`
   hint was dead and selection non-deterministic).

## Consequences

- Positive: correct, indexed `updatedAt` sort; deterministic `use_index` binding; minimal index surface.
- Negative — known debt: the index definitions are duplicated in **three** places
  (`scripts/seed.ts`, `scripts/reset.ts`, and `ensureIndexes` in `src/server/index.ts`). Adding or
  changing an index must update all three (**Index & query** invariant). A new view sort/filter
  field may require a new index.

## Follow-Ups

- Consider extracting a single index-definition source consumed by all three seeders to remove the
  triplication.
