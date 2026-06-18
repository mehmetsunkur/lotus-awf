# 04 — Implementation Notes

## Implemented behavior

- Added dependency-free route helpers in `src/client/main.tsx`.
- Extended route state from app-level routing to include Expense in-app routes.
- View selection writes `/expense.nsf/views/:viewSlug`.
- Document selection writes `/expense.nsf/documents/:docId`.
- Definition selection writes `/expense.nsf/design/...`.
- Popstate updates route state so browser back/forward participates in routing.
- Opening an Expense deep route refreshes the matching route key once; platform-only boot/setup/catalog
  refreshes do not prefetch the default Expense view before a deep route settles.
- M16 keeps `/expense.nsf/design/...` as a compatibility input but normalizes it to
  `/expense.nsf/designer/...`.
- Deploy test probes `/expense.nsf/views/vendors` and `/expense.nsf/design/forms/expense`.

## Known limitations

- Document route restoration only selects documents present in the currently loaded view result set.
- Search/filter state remains local.
- Generic multi-app route generation is deferred.
