# 06 - Implementation Notes

## Implemented

- Added `src/mcp/lotus-client.ts` with username/password login, `lotus_session` cookie replay, and
  one retry on `401`.
- Replaced the generic MCP entrypoint with three non-layered stdio servers:
  `src/mcp/admin-server.ts`, `src/mcp/designer-server.ts`, and `src/mcp/workspace-server.ts`.
- Added admin tools for session/platform state, app list, app creation, and app access management.
- Added designer tools for definitions, workflows, document-type creation, approval workflow
  scaffolding, template export/diff/apply/validation, and workflow patch preview/apply.
- Added workspace tools for definitions, document list/query/get/create/update, and workflow
  transitions.
- Moved pure template design validation to `src/shared/template-validation.ts` and kept the old server
  registry export as a compatibility alias.
- Added local designer validation tools for design definitions and template artifacts.
- Added pure workflow patch operations plus designer preview/apply tools.
- Added `npm run test:mcp`, backed by `playwright.mcp.config.ts`, to exercise all three stdio MCP
  servers against a real Lotus API and CouchDB pair without launching a browser.
- Added `tests/mcp/mcp.spec.ts` for MCP auth, tool-list isolation, admin app creation, designer
  workflow changes, and workspace document operations.
- Added a CouchDB readiness fallback for e2e global setup and the MCP API launcher so tests can use
  Docker container IPs when published localhost ports are not reachable from the host.
- Added Makefile targets for local Claude Code MCP testing: `mcp-api`, `mcp-reset`, `mcp-test`,
  `claude-mcp-admin`, `claude-mcp-designer`, and `claude-mcp-workspace`.
- Added Makefile targets for local Codex CLI MCP testing: per-surface install/remove targets,
  `codex-mcp-install-all`, `codex-mcp-remove-all`, `codex-mcp-list`, and `codex-mcp`.
- Added `docs/context/mcp.md`, taxonomy routing, and an MCP invariant.

## Verification

Passed:

```bash
npm run build
npm run test:unit
npm run test:mcp
```

`npm run test:mcp` runs three MCP stdio integration tests against the real Express API and CouchDB
pair.
