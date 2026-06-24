# 05 - Acceptance

- A coding agent can launch `lotus-admin`, `lotus-designer`, and `lotus-workspace` MCP servers over
  stdio.
- Each MCP server can authenticate to a running Lotus API with username/password and session cookie.
- Admin tools can list apps, create an app, and inspect app access.
- Designer tools can create document types, scaffold approval workflows, validate design changes,
  patch workflows, and export templates.
- Workspace tools can discover views, create/query/update business documents, and run workflow
  transitions.
- Tool lists are isolated: admin does not expose designer/workspace tools, designer does not expose
  admin/workspace tools, and workspace does not expose admin/designer tools.
- MCP tools do not write directly to CouchDB.
- Workspace tools do not mutate design documents.
- Admin/designer tools do not mutate business documents.
- `npm run test:mcp` exercises all three stdio servers against a real Lotus API and CouchDB pair.
- Build and unit tests pass; unavailable e2e/deploy status is recorded.
