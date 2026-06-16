# 05 — Acceptance

## Demo scenario

1. Reset/seed the app and open a view with the search box.
2. Type a term in a searchable field (e.g. `train`) → the list narrows to matching, authorized docs.
3. Type a term with no match → the list is empty; Clear restores the full list.
4. A multi-term query → AND semantics (every term must match).
5. Two docs share a term, one repeating it → the repeat ranks first (relevance order).
6. As a scoped user (Bob, `:3003`), search a term that matches an Alice-only document
   (`Stationery`) → it never appears; searching Bob's own matching doc (`dinner`) still returns it.
7. A term present only in a **non-searchable** field → no match (config-as-data; unit-verified in
   `tests/unit/search.spec.ts`, "ignores non-searchable fields").

## Exit criteria

M9 is complete when the project can prove:

- a free-text query narrows a view to relevance-ranked matches, and clearing it restores the list;
- ranking orders more-relevant (more-hit) documents first;
- searchable fields are driven by data (`searchable` flag), defaulting text-ish fields on and honoring
  explicit opt-in/opt-out;
- search runs against the local replica with no server round-trip (identical offline and server-side);
- search never surfaces a document outside the user's `readers` (it narrows the ACL-scoped set);
- the matcher is pure and deterministic, unit-verified, with no new substrate or Mango index.
