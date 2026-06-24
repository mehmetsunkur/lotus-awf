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

Local stdio Model Context Protocol servers for coding agents. The adapter exposes three non-layered
surfaces: `lotus-admin`, `lotus-designer`, and `lotus-workspace`. Each calls the existing Express API
and imports only pure shared validators/helpers.

## Main Files

- `src/mcp/admin-server.ts` — stdio MCP entrypoint for platform/app/access administration.
- `src/mcp/designer-server.ts` — stdio MCP entrypoint for app design, workflows, and templates.
- `src/mcp/workspace-server.ts` — stdio MCP entrypoint for business document work.
- `src/mcp/runtime.ts` — shared server construction/stdio connection.
- `src/mcp/lotus-client.ts` — HTTP client, username/password login, session-cookie replay, typed API
  errors.
- `src/mcp/tools/admin.ts` — admin tool registration.
- `src/mcp/tools/designer.ts` — designer tool registration.
- `src/mcp/tools/workspace.ts` — workspace tool registration.
- `src/mcp/workflow-patches.ts` — pure workflow patch operations used by preview/apply tools.
- `src/mcp/tool-result.ts` — JSON/error result helpers.

## Key Flows

- Auth: login through `POST /api/session/login`, capture `lotus_session`, replay the cookie on API
  calls, and retry login once on `401`.
- Admin tools: session/platform state, installed apps, app creation, and app ACL management.
- Designer tools: app definitions, workflow scaffolds, document-type scaffolds, template
  export/diff/apply/validation, and workflow patch preview/apply.
- Workspace tools: definitions/view discovery plus business document list/query/get/create/update and
  workflow transitions.
- Validation tools: designer definitions use `src/shared/definition-validation.ts`; template artifacts
  use `src/shared/template-validation.ts`.

## Existing Patterns

- MCP code is a client adapter, not a backend authority.
- The three servers are composable, not layered. Register multiple servers when a user/session needs
  multiple capability sets.
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
- `npm run test:mcp`

`npm run test:mcp` uses `playwright.mcp.config.ts`, starts only the Express API, launches all three
MCP servers over stdio through the official MCP client transport, and reuses the CouchDB Docker setup
from browser e2e.

## Local Claude Code Testing

Use the Makefile targets for local Claude Code MCP sessions:

```bash
make mcp-api
```

Run that in one terminal to start the CouchDB pair and Lotus API. In another terminal, reset state
only when wanted:

```bash
make mcp-reset
```

Then launch Claude Code with a generated local MCP config:

```bash
make claude-mcp-designer
```

The generated config is written to `.tmp/claude-mcp.lotus.json` and is ignored by git because it
contains local credentials. Override defaults with environment variables:

```bash
LOTUS_USERNAME=admin LOTUS_PASSWORD=password123 MCP_API_URL=http://localhost:3001 make claude-mcp-admin
```

Use `make claude-mcp-admin`, `make claude-mcp-designer`, or `make claude-mcp-workspace` depending on
the surface needed for the session.

## Local Codex CLI Testing

Codex CLI manages MCP servers as persistent user config. Register the needed Lotus MCP surface
explicitly:

```bash
make codex-mcp-designer-install
```

Then launch Codex from the project root:

```bash
make codex-mcp
```

Inspect or remove the registration with:

```bash
make codex-mcp-list
make codex-mcp-designer-remove
```

Each install target reuses `MCP_API_URL`, `LOTUS_USERNAME`, and `LOTUS_PASSWORD`, and registers a
stdio server that runs from this repository:

```bash
bash -lc 'cd <repo> && npx tsx src/mcp/<surface>-server.ts'
```

Run `make mcp-api` in another terminal before launching Codex, and run `make mcp-reset` only when
you want to reset local test state.

## Common Pitfalls

- Writing directly to CouchDB from MCP instead of going through Express APIs.
- Letting a tool accept a caller-supplied principal instead of using the authenticated session.
- Adding arbitrary shell execution as an MCP tool.
- Applying workflow patches without first validating the changed definition.
- Mutating business documents or document `readers`/`authors` from MCP tools.
