# 01 - Scope

## Objective

Let an authenticated manager create a new blank business app from `/catalog.nsf`, then open and use it
through `/:appId.nsf`.

## In Scope

- Add catalog UI for creating a business app.
- Validate app ids as lowercase URL/database-safe slugs.
- Reserve system and built-in slugs (`setup`, `catalog`, `login`, `platform`, `expense`).
- Create app databases on both local and server CouchDB targets.
- Write starter design docs into the new app database.
- Record the install in `platform_app` as `appinstall:<appId>`.
- Resolve installed business app routes dynamically.
- Add app-scoped API routes for metadata runtime operations.
- Preserve current unscoped Expense routes as compatibility aliases.
- Add regression coverage for Expense and new app creation.

## Out Of Scope

- Remote template marketplace.
- User-uploaded template registry.
- App deletion, rename, rollback, or governed upgrades.
- Full app ACL editor.
- Multi-tenant isolation.
- Plugin package upload or deployment.
- OIDC/offline login.
- Replacing setup/catalog privileged APIs with metadata actions.

## Decision

M21 creates a starter app programmatically through shared scaffold helpers. JSON-backed blank
templates are deferred until the template registry becomes user-facing.
