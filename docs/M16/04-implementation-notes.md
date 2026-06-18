# 04 - Implementation Notes

## Implemented behavior

- Extended `ExpenseRoute` with Designer routes in `src/client/main.tsx`.
- Added `/expense.nsf/designer/...` route generation and parsing.
- Added `RuntimeSidebar` for view navigation, form-backed create actions, and opening Designer.
- Added `DesignerSidebar` for forms, views, and workflows.
- Moved `DefinitionEditor` out of the runtime page and into Designer.
- Added explicit document open-new-tab links in the document table.
- Added a small `newDocType` state so create actions can open forms independently of the active view.
- Added `GET /api/documents/:id` so direct document routes load by id from the local replica.
- Direct document routes render a focused document workspace without the view list/search.

## Verification notes

- `npm run build`, `npm run test:unit`, and `npm run test:deploy` passed locally.
- Targeted Chromium probes against a fresh deploy container verified runtime left navigation, `New Vendor`,
  direct document routes, and direct Designer routes.
- `npm run test:e2e` could not execute in this environment because host `localhost:5985` was not
  reachable after Docker published the CouchDB port; use deploy/browser verification or a host where
  Docker-published ports are reachable.
