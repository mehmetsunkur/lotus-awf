# 01 — Scope

## M9 objective

Establish full-text search: a free-text query narrows a view's ACL-scoped documents, ranked by
relevance, via a pure matcher that runs identically on the server and the local replica.

## The search model (key decision)

Search is a **pure, portable matcher** (`src/shared/search.ts`) applied by the server **after** the
existing ACL-scoped `findDocs` + `canReadDocument` filter. Because the same pure code runs everywhere,
search behaves identically server-side and offline against the local CouchDB node — the codebase's
"device/offline" tier (there is no in-browser DB). No new substrate: CouchDB Mango has no real FTS and
3.x ships no Lucene, so rather than add an engine we match in-memory over the candidate set the view
query already returns. See `docs/decisions/0004-search-as-shared-matcher.md`.

What is searchable is **data**, consistent with definitions-as-data: an optional
`searchable?: boolean` on `FormField`.

## In scope

- A pure matcher in `src/shared/search.ts`: `fold`, `tokenize`, `searchableFields`, `scoreDocument`,
  `searchDocuments` — accent-folded, case-insensitive, AND-of-terms, prefix match, field-weighted
  ranking.
- An optional, back-compatible `searchable?: boolean` on `FormField`, validated by the shared
  definition validator (text-ish types default on).
- `GET /api/views/:id/documents?q=` applying the matcher after the ACL filter (search never widens).
- A per-view search box in the runtime UI (`data-testid="view-search"`).
- Seed `searchable` flags demonstrating opt-in and opt-out.

## Out of scope

- A search engine / index: Lucene, couchdb-nouveau, Couchbase, or an in-browser FTS index.
- An inverted index or derived `searchTokens` envelope field (a later scale step; the matcher scans the
  candidate set the view returns).
- Global cross-view / cross-docType search (`GET /api/search?q=`) — M9 scopes search within one view.
- Stemming, stopwords, fuzzy/typo tolerance, phrase queries, snippets/highlighting.
- On-device search in a browser-resident DB (there is none; "device" is the local CouchDB node).
- Production authorization for the endpoint (same non-production posture as M4–M8).

## Product framing

M9 is the Notes "full-text find" re-centered on offline-first: a citizen marks fields searchable in a
replicated form definition; the same matcher narrows results for a user, ranked, online or offline,
and never shows a document the user cannot already read.
