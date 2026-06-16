# 06 — Implementation Notes

## Implemented runtime behavior

M9 adds full-text search over a view's ACL-scoped documents:

- a pure matcher (`src/shared/search.ts`) — accent-folded, case-insensitive, AND-of-terms, prefix
  match, field-weighted ranking, empty-query passthrough;
- `searchable?: boolean` on `FormField`, validated by the shared definition validator (text-ish types
  default on);
- `GET /api/views/:id/documents?q=` applies the matcher **after** the `canReadDocument` ACL filter;
- a per-view search box in the runtime UI (commit/clear refetch via a committed-query ref).

The seed marks expense `description` searchable and excludes the opaque `vendorId` select.

## Architecture

Matching/ranking is pure and portable (`src/shared/search.ts`), unit-tested, exactly like the workflow
and agent engines. The server orchestrates the I/O (the local view query, the form load, the ACL
filter) around it. Because the same pure code runs in the browser, on the API, and against the local
replica, search is identical offline-on-device and server-side — no new substrate (see
`docs/decisions/0004-search-as-shared-matcher.md`).

## ACL and correctness

Search runs on `readable` — the set already filtered by `accessSelector` + `canReadDocument` — so it
can only narrow visibility, never widen it. The matcher is deterministic (no `now`/locale dependence),
so client and server agree. An empty/whitespace query is a passthrough, preserving the M4 list path.

## Verification performed

```bash
npm run build                                  # tsc --noEmit + vite build
npm run test:unit                              # search matcher + validation
npx playwright test tests/e2e/search.spec.ts   # filtering, ranking, ACL scoping
npm run test:e2e                               # full suite
```

## Known limitations and risks

- No inverted index: the matcher scans the candidate set the view returns (`limit: 200`). Fine at this
  scale; a derived `searchTokens` envelope field + Mango prefilter is the future scale step and would
  not change the matcher contract.
- Search is scoped within a single view; global cross-view / cross-docType search is deferred.
- No stemming, stopwords, fuzzy/typo tolerance, phrase queries, or snippet/highlight rendering.
- "Device/offline" is the local CouchDB node; there is no in-browser FTS index (none exists to index).
