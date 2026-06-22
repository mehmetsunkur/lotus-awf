# Client

## Doc Sync Metadata

- Last code review baseline: `bbdadaf`
- Last reviewed date: `2026-06-16`
- Code areas:
  - `src/client/**`
- Tests:
  - `tests/e2e/**`
- Config/runtime areas:
  - `vite.config.ts`
  - `index.html`
- Review trigger:
  - Update this doc when the runtime UI shell, form/view rendering, the save/transition flow, or the
    conflict resolution UI change.

## Purpose

React platform/runtime UI: first-run setup and app catalog (M14), plus the metadata-driven runtime
that renders forms/views from replicated definitions, edits local documents, hosts the M4 structured
definition studio (with JSON escape hatch), the conflict resolution panel, and M18 login/logout.

## Main Files

- `src/client/main.tsx` — the single-file platform/runtime shell (status strip, runtime/designer
  workspaces, document table/form, M4 definition studio, conflict panel, and the M3 `WorkflowBar` /
  `WorkflowHistory` and per-revision conflict resolution).
- `src/client/styles.css`.

## Key Flows

- Boot (M14) → `GET /api/platform/state` → route/render `/setup.nsf`, `/catalog.nsf`, or
  `/expense.nsf`. If setup is complete but no session is authenticated, route/render `/login.nsf`.
- Login/logout (M18) → login form posts to `POST /api/session/login`; logout posts to
  `POST /api/session/logout`, refreshes platform state, and returns to login. The session cookie is
  HTTP-only, so the client only observes session state through API responses.
- In-app routing (M15/M16) → the app runtime parses `/expense.nsf/views/*`,
  `/expense.nsf/documents/*`, `/expense.nsf/new/*`, and `/expense.nsf/designer/*`.
  View/document/create/definition selections push matching URLs and browser back/forward updates
  selected state.
- App runtime boot → `GET /api/status|definitions|conflicts` → render shell (`platform/state`
  carries the authenticated person/groups, while definition/runtime APIs are session-protected).
- First-run setup (M14/M18) → `POST /api/platform/setup` stores org/domain/admin, creates the admin
  Person and `group:admins`, sets a session cookie, then catalog renders with no business apps
  installed.
- Sample install (M14) → catalog `POST /api/platform/install-sample/expense`, then the user can open
  the existing Expense runtime.
- Edit → shared `validatePayload` runs client-side → `POST/PUT /api/documents` (local replica).
- Compute (M7) → `applyComputedFields` (shared) derives `compute` fields from the live draft, offline;
  computed fields render read-only and recompute as inputs change.
- Transition (M3) → `WorkflowBar` renders `availableTransitions` (shared engine) → `POST
  /api/documents/:id/transition` → refresh.
- Authoring (M4/M16) → Designer workspace left pane lists forms/views/workflows; structured controls
  update the JSON definition in memory → shared `validateDesignDefinition` runs client-side →
  `PUT /api/definitions/:id` (local replica) → refresh.
- Layout studio (M11) → `FormStudio` groups fields by section with move buttons, a move-to-section
  select, and native HTML5 drag, all routed through `src/shared/form-layout.ts` (keeps the form
  normalized). A live preview reuses `DocumentForm` in read-only `preview` mode (`FieldEditor`'s
  `testIdPrefix` → `preview-field-*`, no collision with the live `field-*`). Saves via the M4 path.
- New document type (M12) → the studio's "New document type" form (`new-type-form`) `POST`s
  `/api/document-types`; on success the studio + view picker point at the new type, and the refresh
  surfaces its view tab. Errors (409/422) surface in the status message.
- Conflict resolve → "Keep This Revision" on any revision → `POST /api/conflicts/:id/resolve` with
  `chosenRev` so the elected state/history survives.
- Switch view does NOT auto-refetch documents; a refresh does (see `tests/e2e/support/fixtures.ts`).
- Search (M9) → the per-view search box (`data-testid="view-search"`) commits a query to
  `GET /api/views/:id/documents?q=` and refetches. A ref holds the committed query so submit/clear never
  refetch with a stale closure; like view switching, a refetch happens on submit, not per keystroke.
- Audit (M10) → a read-only audit-trail panel (`data-testid="audit-trail"`) renders the selected
  document's events, fetched from `GET /api/audit?docId=` (local server) on selection. Events are
  recorded server-authoritatively and ACL-scoped server-side; the panel only displays them.

## Existing Patterns

- Validation/visibility/defaults come from `src/shared` (same code as the API).
- Definition validation comes from `src/shared/definition-validation.ts` (same code as the API).
- Stable selectors: elements carry `data-testid` for e2e (see `tests/e2e/`).

## Invariants

See `docs/invariants.md`: **Validation parity**, **Offline editing**, **Form layout authoring**, and
**Identity & sessions**, and **Deployable artifact** govern this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0002-offline-first-dual-couchdb.md`
- `docs/decisions/0010-directory-and-session-auth.md`

## Tests

`tests/e2e/**` (Playwright). The dev server must run non-watch (`npm run test:serve`) to avoid
the host `fs.inotify` `EMFILE` limit.

## Common Pitfalls

- Re-implementing validation in the component instead of using `src/shared`.
- Adding a save/option path that requires the server replica (breaks offline).
- Removing/renaming a `data-testid` relied on by e2e specs.
- Reading or storing the session token in client state; the browser should only receive public
  session state from the API.
