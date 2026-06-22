# 03 - Runtime Flow

The built client starts with `GET /api/platform/state`, then resolves the browser path.

## Route Resolution

1. If setup is incomplete, render first-run setup at `/setup.nsf`.
2. If setup is complete and the session is unauthenticated, render `/login.nsf`.
3. If an authenticated user opens `/login.nsf`, route to `/catalog.nsf`.
4. `.nsf` app routes render a standard workspace with left navigation and right content.
5. `expense.nsf` continues to load forms, views, workflows, documents, conflicts, options, and audit
   through the local-first metadata runtime.
6. `setup.nsf` loads directory state through manager-only setup APIs and renders the selected section
   inside the common workspace.
7. `catalog.nsf` renders platform state sections inside the common workspace and keeps sample install
   actions on the existing platform API.

## Standard Workspace

The workspace has:

- a top status/header area;
- a left app navigation pane;
- a right content pane;
- stable `data-testid="runtime-workspace"` and app-specific shell selectors.

System app navigation is section-based in M20. Expense navigation remains metadata-driven from
`view:*` and `form:*` definitions.
