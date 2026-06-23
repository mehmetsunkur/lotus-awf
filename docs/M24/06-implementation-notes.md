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
- Added `docs/context/mcp.md`, taxonomy routing, and an MCP invariant.

## Verification

Passed during implementation:

```bash
npm run build
npm run test:unit
```

The full final verification result is recorded in the implementation summary.
