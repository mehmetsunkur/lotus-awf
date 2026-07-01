# ADR-0016: Templates replace the "sample app" concept

Date: 2026-07-01

## Status

Proposed. Implemented (verified via tsc + unit + API-driven e2e; UI-tab e2e and Docker
deploy run only in a reliable environment).

## Context

After ADR-0015 retired the expense specialization, "installing a sample app" was just
"deploying an app from a bundled template" — but the codebase still carried a separate
**sample** concept: `SampleApp`, `samples[]` on `PlatformState`, `POST /api/platform/install-sample/:appId`,
`installSampleApp`, and a catalog "Sample Templates" section with install/open buttons. A sample
also installed to a **fixed appId** baked into its template JSON, so one template could deploy as
exactly one app. That's redundant now: a template *is* a portable design, and deployment is just
instantiating it as an app you name.

## Taxonomy

- Subsystem: Server, Shared, Client
- Domain Area: App lifecycle, Definition contract
- Risk Class: Contract / back-compat (breaking)
- Runtime Surface: Internal API, Web UI, Deploy Artifact

## Decision

Fold "sample apps" into a single **create-app-from-template** flow:

- `POST /api/platform/apps` accepts `{ appId, title, fromTemplate }` — instantiate a bundled
  template as an app — *or* the existing `{ appId, title, docType, docTypeTitle }` for a blank app.
- **Templates are appId-agnostic.** `instantiateTemplate(templateId, appId, title)` re-stamps every
  template doc's `appId` to the chosen app and sets `app:config.database`/`title` accordingly. The
  template JSON's own `appId` is just an authored default — one template deploys as many apps
  (e.g. the `expense` template as `expense` *or* `travel-expenses`).
- `PlatformState.samples: SampleApp[]` → `availableTemplates: AppTemplate[]` (`{ id, title, description }` —
  no `installed` flag, no fixed appId/database). The catalog "Templates" section lists them; the card
  shows **Deploy** (create app from the template) or **Open** (if an app of that id already exists).
- Removed: `POST /api/platform/install-sample/:appId`, `installSampleApp`, `SampleApp`.

## Alternatives considered

1. **Rename only** (`samples`→`templates`, keep fixed-appId install) — rejected: leaves the "one
   template → one app" limitation and a parallel install path.
2. **Leave as-is** — rejected: the sample concept is legacy vocabulary post-retire.

## Consequences

- Positive: one concept (a template), one deploy path (create app), instantiable under any appId.
  Unifies the bundled registry with the existing export/apply template artifacts conceptually.
- Positive: base carries no "sample" framing; the catalog is "deploy an app from a template."
- Negative: **breaking** — `install-sample` and `PlatformState.samples` are gone; the deploy test
  and one catalog testid migrate. Dev/e2e `reset` still seeds the expense app (via the template
  docs) so most e2e are unaffected.
- Note: the catalog card deploys with `appId = template.id` by default; deploying the same template
  under a custom appId is available via the create-app form (`fromTemplate` + chosen appId).

## Follow-ups

- Optional: a catalog "create from template" form that lets the operator pick both a template and a
  custom appId (the API already supports it).
- Unify bundled templates with user-exported template artifacts behind one "templates" surface.
