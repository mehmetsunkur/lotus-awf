# 03 — Search Runtime

## Where the matcher runs

The matcher is pure (`src/shared/search.ts`) and does no I/O. The **server** orchestrates around it,
exactly like the workflow (M3) and agent (M8) engines:

```
GET /api/views/:id/documents?q=
  → findDocs(local, { selector: mangoSelector(view) + accessSelector(scope), ... })   // ACL-scoped query
  → docs.filter(canReadDocument)                                                       // ACL post-filter → `readable`
  → q present? searchDocuments(readable, formForDocType(view.docType), q) : readable   // M9: narrow + rank
```

Two properties fall out of this ordering:

1. **ACL-narrowing is structural.** Search only ever sees `readable`, so it cannot surface a document
   the user could not already read. The same code, run on the local replica, gives the same result —
   "server + offline-on-device" with one implementation.
2. **No new substrate.** The matcher runs in-memory over the candidate set the view query already
   returns (currently `limit: 200`). No Mango index is added; the three-index set is untouched.

The form is read from the **local** node only when `q` is present, so the non-search path keeps its
M4 behavior and cost, and the search path stays offline-safe.

## The UI (`src/client/main.tsx`)

A per-view search box (`data-testid="view-search"`) sits between the view picker and the workspace:

- A controlled input (`view-search-input`) holds what the user is typing.
- A ref holds the **committed** query that `refresh()` reads, so Submit and Clear never refetch with a
  stale closure.
- Submit (`view-search-submit`) commits the input and refetches; Clear (`view-search-clear`) resets to
  the empty query and refetches the full list. Like view switching, a refetch happens on submit, not on
  every keystroke (consistent with the existing "switching a view does not auto-refetch" pattern).

## Scale and limits

- The matcher scans the candidate set the view returns; there is no inverted index. Fine at this
  scale, a candidate for a derived `searchTokens` envelope field + Mango prefilter under load (noted in
  ADR-0004), which would not change the matcher contract.
- Search is scoped within one view; global cross-view search is deferred.
