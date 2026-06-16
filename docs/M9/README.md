# M9 — Full-text Search

M9 gives the platform **search**: a free-text query narrows a view's documents, ranked by relevance,
running identically server-side and offline against the local replica. This is the "search" capability
the vision's Phase 9 names alongside the already-landed promotion (M6) and agents (M8).

M1–M8 proved the replica substrate, the metadata runtime, workflow, authoring, security, template
promotion, the plugin/handler runtime, and agents. M9 proves the same definitions-as-data + pure-logic
posture can deliver search **without new substrate** and **without breaking ACL scoping or
offline-first**.

## Goal

- A pure, portable matcher (`src/shared/search.ts`): accent-folded, case-insensitive, AND-of-terms,
  prefix match, ranked by field-weighted hit count.
- Searchable fields are **data**: an optional `searchable?: boolean` on `FormField` (text-ish fields
  default on; opt a non-text field in or a text field out).
- `GET /api/views/:id/documents?q=` applies the matcher **after** the ACL-scoped query, so search only
  ever narrows visibility.
- A per-view search box in the runtime UI.
- Identical behavior server-side and offline-on-device (the local CouchDB node) — no Lucene, no Pouch,
  no new Mango index.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary, the search-model decision, non-goals |
| [02-search-contract.md](02-search-contract.md) | The `searchable` flag, matcher semantics, query API |
| [03-search-runtime.md](03-search-runtime.md) | Where the matcher runs, ACL ordering, the UI |
| [04-build-plan.md](04-build-plan.md) | Implementation steps |
| [05-acceptance.md](05-acceptance.md) | Demo flow and exit criteria |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

M9 is the Notes "full-text find" re-centered on offline-first and ACL.

The working question is:

> Can replicated form definitions drive relevance-ranked search that runs identically server-side and
> offline against the local replica, narrowing the ACL-scoped set without new substrate or leakage?
