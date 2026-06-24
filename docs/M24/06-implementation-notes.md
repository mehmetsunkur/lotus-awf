# 06 - Implementation Notes

## Implemented

- Added a stdio MCP server entrypoint at `src/mcp/server.ts` and `npm run mcp`.
- Added `src/mcp/lotus-client.ts` with username/password login, `lotus_session` cookie replay, and
  one retry on `401`.
- Added read tools for session, platform state, app list, app definitions, workflow lookup, workflow
  scaffold options, template export, and template diff.
- Added safe mutation tools for document-type creation and approval workflow scaffolding. Both call
  existing app-scoped Express APIs.
- Moved pure template design validation to `src/shared/template-validation.ts` and kept the old server
  registry export as a compatibility alias.
- Added local validation tools for design definitions and template artifacts.
- Added pure workflow patch operations plus `lotus_preview_workflow_patch` and
  `lotus_apply_workflow_patch`.
- Added `npm run test:mcp`, backed by `playwright.mcp.config.ts`, to exercise the stdio MCP server
  against a real Lotus API and CouchDB pair without launching a browser.
- Added `tests/mcp/mcp.spec.ts` for MCP auth, app reads, document-type creation, approval workflow
  scaffold, workflow patch preview/apply, and template export.
- Added a CouchDB readiness fallback for e2e global setup and the MCP API launcher so tests can use
  Docker container IPs when published localhost ports are not reachable from the host.
- Added Makefile targets for local Claude Code MCP testing: `mcp-api`, `mcp-reset`, `mcp-test`, and
  `claude-mcp`.
- Added Makefile targets for local Codex CLI MCP testing: `codex-mcp-install`, `codex-mcp-remove`,
  `codex-mcp-list`, and `codex-mcp`.
- Added `docs/context/mcp.md`, taxonomy routing, and an MCP invariant.

## Verification

Passed:

```bash
npm run build
npm run test:unit
npm run test:mcp
```

`npm run test:mcp` ran one MCP stdio integration test against the real Express API and CouchDB pair.
