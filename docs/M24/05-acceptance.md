# 05 - Acceptance

- A coding agent can launch `lotus-admin`, `lotus-designer`, and `lotus-workspace` MCP servers over
  stdio.
- Each MCP server can authenticate to a running Lotus API with username/password and session cookie.
- Admin tools can list apps, create an app, and inspect app access.
- Admin tools can read the names.nsf directory and manage people and groups (create/update person,
  set password, create/update group, add/remove members). Writes are manager-only (enforced by the
  server), passwords are write-only and never returned, and the last active admin cannot be removed.
- Admin tools can list bundled templates and install one as a new app, reporting ACL principals the
  directory cannot resolve so they can be created.
- Designer tools can create document types, scaffold approval workflows, validate design changes,
  patch workflows, and export templates.
- Workspace tools can discover views, create/query/update business documents, and run workflow
  transitions.
- Tool lists are isolated: admin does not expose designer/workspace tools, designer does not expose
  admin/workspace tools, and workspace does not expose admin/designer tools.
- MCP tools do not write directly to CouchDB.
- Workspace tools do not mutate design documents.
- Admin/designer tools do not mutate business documents, except that admin template install seeds a
  bundled template's sample documents into the new app it creates.
- `npm run test:mcp` exercises all three stdio servers against a real Lotus API and CouchDB pair.
- Build and unit tests pass; unavailable e2e/deploy status is recorded.
