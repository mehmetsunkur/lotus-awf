# 02 — Search Contract

## The `searchable` flag (definitions-as-data)

`FormField` gains an optional, back-compatible field:

```ts
searchable?: boolean;
```

- Absent (every M1–M8 form): **text-ish** types (`text`, `textarea`, `select`) are searchable; other
  types are not.
- `true`: force-index this field (e.g. a `number`).
- `false`: exclude this field (e.g. an opaque `select` holding an id).

The shared definition validator (`src/shared/definition-validation.ts`) rejects a non-boolean
`searchable`. The flag is optional and never makes an existing field required, so already-replicated
definitions stay valid (**Definitions-as-data contract** invariant).

## Matcher semantics (`src/shared/search.ts`)

Pure, dependency-free, deterministic, and locale-independent — identical in the browser, the API, and
against the local replica.

- **`fold(text)`** — `NFD` normalize, strip combining marks, lowercase. Accent- and case-insensitive
  without `Intl`/locale dependence.
- **`tokenize(text)`** — fold, split on non-alphanumeric (`\p{L}\p{N}`), drop empties.
- **`searchableFields(form)`** — the fields above, each weight `1`.
- **`scoreDocument(doc, fields, terms)`** — for each query term, sum field-weighted **prefix** hits
  across searchable payload values; returns `null` if any term matches nothing (**AND-of-terms**).
- **`searchDocuments(docs, form, query)`** — filter to matches, order by descending score with a
  stable tie-break (input order preserved). An **empty query is a passthrough** that returns the input
  list unchanged (the server's ACL/sort order).

Non-string payload values are flattened to text (arrays/objects joined recursively) before tokenizing.

## Query API

```
GET /api/views/:id/documents?q=<query>
```

- No `q` (or whitespace-only): unchanged M4 behavior — the ACL-scoped, view-sorted list.
- With `q`: the same list, then `searchDocuments` applied. Results are the **intersection** of "user
  can read" and "matches the query", ranked. The matcher reads the view's form from the **local**
  CouchDB, so the path stays offline-safe.

## Invariants honored

- **ACL / readers**: search runs on the already `readers`-filtered set; it can only narrow, never widen.
- **Offline editing**: query + form load hit the local node; no server-replica round-trip.
- **Index & query**: no new Mango index; the three-index set is untouched.
- **Definitions-as-data contract**: `searchable` is optional and back-compatible.
