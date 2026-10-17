# 01 - Scope

## In scope

- Add a stdio MCP server process for coding agents.
- Authenticate with `POST /api/session/login` and replay the returned `lotus_session` cookie.
- Expose tools for platform/app discovery, definition inspection, workflow inspection, and template
  export/diff.
- Expose admin tools for reading and managing names.nsf people and groups through `/api/names/*`.
- Expose admin tools for listing bundled templates and installing one as a new app.
- Expose tools for document-type creation and approval workflow scaffolding.
- Expose validation tools for individual definitions and template artifacts.
- Expose guarded workflow patch tools for common state/transition edits.
- Apply design changes only through app-scoped Express APIs.
- Add unit coverage for MCP client/tool helpers and workflow patch behavior.

## Out of scope

- Direct CouchDB access from MCP tools.
- Bearer tokens, service accounts, OAuth, or API-key auth.
- Arbitrary shell execution from MCP tools.
- Visual workflow graph authoring.
- App deletion, workflow deletion, app rename, or template rollback.
- Editing business documents through MCP.
- Changing document `readers` or `authors`.
- Adding Mango indexes or changing query strategy.

## Taxonomy

- Subsystem: Server, Shared, MCP adapter.
- Domain Area: Definitions-as-data, workflow, app lifecycle, identity/session auth, template
  promotion.
- Change Type: Feature.
- Risk Class: Contract/back-compat, validation parity, identity/session, ACL/readers,
  replication/conflict.
- Runtime Surface: MCP stdio process, Internal API, CLI/script.
- Ownership Boundary: MCP imports `src/shared/**` pure validators and calls `src/server/**` only over
  HTTP.

## Required context

- `docs/context/server.md`
- `docs/context/shared.md`
- `docs/invariants.md`
- `docs/testing-guide.md`
- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0010-directory-and-session-auth.md`
- `docs/M6/02-template-contract.md`
- `docs/M21/03-route-api-contract.md`
- `docs/M23/02-scaffold-contract.md`
