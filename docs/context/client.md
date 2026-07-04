# Client

## Doc Sync Metadata

- Last code review baseline: `fc10327`
- Last reviewed date: `2026-07-04`
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

React platform/runtime UI: first-run setup and app catalog (M14), catalog-created business apps
(M21), plus the metadata-driven runtime that renders forms/views from replicated definitions, edits
local documents, hosts the M4 structured definition studio (with JSON escape hatch), the conflict
resolution panel, and M18 login/logout.

## Main Files

- `src/client/main.tsx` — the single-file platform/runtime shell (status strip, runtime/designer
  workspaces, document table/form, M4 definition studio, conflict panel, and the M3 `WorkflowBar` /
  `WorkflowHistory` and per-revision conflict resolution).
- `src/client/styles.css`.

## Key Flows

- Boot (M14/M19/M20/M21, ADR-0012) → `GET /api/platform/state` → when setup is incomplete render the
  `/setup.nsf` first-run wizard; otherwise route/render `/catalog.nsf`, `/names.nsf`, or an installed
  business app such as `/expense.nsf` / `/:appId.nsf`. If setup is complete but no session is
  authenticated, route/render `/login.nsf`. After setup, `/names.nsf` opens the authenticated
  Directory Console in the standard NSF workspace and `/setup.nsf` redirects there.
- Login/logout (M18) → login form posts to `POST /api/session/login`; logout posts to
  `POST /api/session/logout`, refreshes platform state, and returns to login. The session cookie is
  HTTP-only, so the client only observes session state through API responses.
- In-app routing (M15/M16/M20/M21) → the app runtime parses generic `/:appSlug.nsf/views/*` routes
  for system apps and installed business apps (`views`, `documents`, `new`, and `designer`).
  View/document/create/definition selections push matching URLs and browser back/forward updates
  selected state. Unknown business app slugs return to `/catalog.nsf`.
- App runtime boot → `GET /api/apps/:appId/status|definitions|conflicts` for business apps
  (app-scoped only — ADR-0015; no unscoped aliases) → render shell (`platform/state` carries the
  authenticated person/groups, while definition/runtime APIs are session-protected).
- First-run setup (M14/M18) → `POST /api/platform/setup` stores org/domain/admin, creates the admin
  Person and `group:admins`, sets a session cookie, then catalog renders with no business apps
  installed.
- Deploy from template (M14/ADR-0016) → the catalog "Templates" section loops over
  `state.availableTemplates`; "Deploy" calls `POST /api/platform/apps { appId, title, fromTemplate }`
  (instantiate the template as an app), "Open" navigates to an already-deployed one. Blank apps
  (M21) use the same endpoint without `fromTemplate`. All open through `/:appId.nsf`.
- System app shell (M20) → `/catalog.nsf` and `/names.nsf` use the same left-navigation /
  right-content workspace as business apps. Catalog sections are System Apps, Installed Apps, and
  Sample Templates; names sections are People, Groups, and Installed Apps.
- Directory Console (M19/M20, ADR-0012) → catalog System apps card opens `/names.nsf/views/people`; the console
  fetches `GET /api/names/directory` for any active authenticated person and calls manager-only
  People/Groups mutation APIs. Non-managers get a read-only directory; managers see create/edit,
  password, active-state, and group-membership controls. It renders only public person data, groups,
  and installed-app summaries inside the standard workspace.
- Edit → shared `validatePayload` runs client-side → `POST/PUT /api/apps/:appId/documents` (local replica).
- Compute (M7) → `applyComputedFields` (shared) derives `compute` fields from the live draft, offline;
  computed fields render read-only and recompute as inputs change.
- Formula fields (ADR-0014) → a `type: "formula"` field renders read-only (`<output>`), its value fetched
  from `GET .../documents/:id/formulas` when the selected form has formula fields (server-resolved,
  ACL-scoped, may read other apps). Excluded from the editable draft/validation/payload, so the edit path
  stays offline; the derived value is display-only and blank offline.
- Transition (M3) → `WorkflowBar` renders `availableTransitions` (shared engine) → `POST
  /api/documents/:id/transition` → refresh.
- Authoring (M4/M16) → Designer workspace left pane lists forms/views/workflows; structured controls
  update the JSON definition in memory → shared `validateDesignDefinition` runs client-side →
  `PUT /api/definitions/:id` (local replica) → refresh.
- App access editing (M22) → Designer Access panel (`/:appId.nsf/designer/access`) fetches
  `GET /api/apps/:appId/access`, edits `acl:rules.entries`, and saves with
  `PUT /api/apps/:appId/access`. Users below designer access are redirected away from Designer; only
  managers can read/write the Access panel.
- Layout studio (M11) → `FormStudio` groups fields by section with move buttons, a move-to-section
  select, and native HTML5 drag, all routed through `src/shared/form-layout.ts` (keeps the form
  normalized). A live preview reuses `DocumentForm` in read-only `preview` mode (`FieldEditor`'s
  `testIdPrefix` → `preview-field-*`, no collision with the live `field-*`). Saves via the M4 path.
- New document type (M12) → the studio's "New document type" form (`new-type-form`) `POST`s
  `/api/document-types`; on success the studio + view picker point at the new type, and the refresh
  surfaces its view tab. Errors (409/422) surface in the status message.
- Workflow scaffold (M23) → when a selected form has no matching workflow, the Designer shows an
  approval scaffold panel (`workflow-scaffold-panel`). It fetches designer-level sanitized approver
  options, posts to `/api/apps/:appId/workflows/scaffold`, refreshes definitions, and opens the new
  `workflow:<docType>` in the existing workflow editor.
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
- `docs/decisions/0012-names-directory-split.md`
- `docs/decisions/0014-formula-language-and-agents.md`
- `docs/decisions/0015-retire-expense-specialization.md`

## Tests

`tests/e2e/**` (Playwright). The dev server must run non-watch (`npm run test:serve`) to avoid
the host `fs.inotify` `EMFILE` limit.

## Common Pitfalls

- Re-implementing validation in the component instead of using `src/shared`.
- Adding a save/option path that requires the server replica (breaks offline).
- Removing/renaming a `data-testid` relied on by e2e specs.
- Reading or storing the session token in client state; the browser should only receive public
  session state from the API.
- Treating system apps as removable business app installs; `names.nsf` comes from
  `PlatformState.systemApps`.
- Reintroducing one-off full-page system app layouts; first-party `.nsf` apps should use the M20
  standard workspace unless a later ADR carves out an exception.
- Showing Designer entry points to users below `designer` access.
- Hiding the workflow scaffold behind the manager-only Access panel; designers need sanitized
  approver options without access-edit privileges.
