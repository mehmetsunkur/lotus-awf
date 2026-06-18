# 04 - Implementation Notes

## Implemented behavior

- Extended `ExpenseRoute` with Designer routes in `src/client/main.tsx`.
- Added `/expense.nsf/designer/...` route generation and parsing.
- Kept `/expense.nsf/design/...` as a compatibility input that normalizes to Designer routes.
- Added `RuntimeSidebar` for view navigation, form-backed create actions, and opening Designer.
- Added `DesignerSidebar` for forms, views, and workflows.
- Moved `DefinitionEditor` out of the runtime page and into Designer.
- Added explicit document open-new-tab links in the document table.
- Added a small `newDocType` state so create actions can open forms independently of the active view.

## Verification notes

- `npm run build`, `npm run test:unit`, and `npm run test:deploy` passed locally.
- Targeted Chromium probes against a fresh deploy container verified runtime left navigation, `New Vendor`,
  direct Designer routes, and legacy `/design/...` normalization.
- `npm run test:e2e` could not execute in this environment because host `localhost:5985` was not
  reachable after Docker published the CouchDB port; use deploy/browser verification or a host where
  Docker-published ports are reachable.
