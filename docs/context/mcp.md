# MCP Adapter

## Doc Sync Metadata

- Last code review baseline: `TBD`
- Last reviewed date: `2026-06-23`
- Code areas:
  - `src/mcp/**`
- Tests:
  - `tests/unit/workflow-patches.spec.ts`
- Config/runtime areas:
  - `package.json`
- Review trigger:
  - Update this doc when MCP tools, auth flow, mutation safety rules, or MCP runtime assumptions
    change.

## Purpose

Local stdio Model Context Protocol server for coding agents. It exposes Lotus app/design operations
by calling the existing Express API and importing only pure shared validators/helpers.

## Main Files

- `src/mcp/server.ts` — stdio MCP entrypoint.
- `src/mcp/lotus-client.ts` — HTTP client, username/password login, session-cookie replay, typed API
  errors.
- `src/mcp/tools.ts` — MCP tool registration.
- `src/mcp/workflow-patches.ts` — pure workflow patch operations used by preview/apply tools.
- `src/mcp/tool-result.ts` — JSON/error result helpers.

## Key Flows

- Auth: login through `POST /api/session/login`, capture `lotus_session`, replay the cookie on API
  calls, and retry login once on `401`.
- Read tools: session/platform/app/definition/workflow/template discovery through app-scoped API
  routes.
- Safe creation tools: document-type creation and approval workflow scaffold wrap existing
  app-scoped endpoints, so server-side designer access and validation remain authoritative.
- Validation tools: individual definitions use `src/shared/definition-validation.ts`; template
  artifacts use `src/shared/template-validation.ts`.
- Workflow patch tools: fetch `workflow:<docType>`, apply pure operations in memory, validate the
  changed definition, and write through `PUT /api/apps/:appId/definitions/:id` only when valid.

## Existing Patterns

- MCP code is a client adapter, not a backend authority.
- Every app-scoped tool requires explicit `appId`.
- Tools return structured JSON as text content for broad MCP client compatibility.
- Mutating tools prefer existing API endpoints and shared validation over custom write behavior.

## Invariants

See `docs/invariants.md`: **MCP agent interface**, **Identity & sessions**, **Definitions-as-data
contract**, **Validation parity**, **ACL / readers**, and **Replication & conflict** govern this
subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0010-directory-and-session-auth.md`
- `docs/M24/02-tool-contract.md`

## Tests

- `npm run build`
- `npm run test:unit`

## Common Pitfalls

- Writing directly to CouchDB from MCP instead of going through Express APIs.
- Letting a tool accept a caller-supplied principal instead of using the authenticated session.
- Adding arbitrary shell execution as an MCP tool.
- Applying workflow patches without first validating the changed definition.
- Mutating business documents or document `readers`/`authors` from MCP tools.
