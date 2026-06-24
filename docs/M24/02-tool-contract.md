# 02 - Tool Contract

## Configuration

Each MCP server reads the same configuration from environment variables:

| Variable | Required | Meaning |
| --- | --- | --- |
| `LOTUS_API_URL` | no | Base API URL. Defaults to `http://localhost:3001`. |
| `LOTUS_USERNAME` | yes for protected tools | Login username. |
| `LOTUS_PASSWORD` | yes for protected tools | Login password. |

All three servers use the existing session-cookie login flow. They never accept a client-supplied
principal and never bypass app ACL checks.

## Surfaces

M24 exposes three non-layered stdio MCP servers:

- `lotus-admin` (`src/mcp/admin-server.ts`) for platform/app lifecycle and app access.
- `lotus-designer` (`src/mcp/designer-server.ts`) for design definitions, workflows, and templates.
- `lotus-workspace` (`src/mcp/workspace-server.ts`) for business document work.

Users can register one or more servers depending on their role and task. The surfaces are
composable, not hierarchical: admin does not include designer/workspace tools, and designer does not
include workspace tools.

## Admin tools

- `lotus_admin_get_session`
- `lotus_admin_get_platform_state`
- `lotus_admin_list_apps`
- `lotus_admin_create_app`
- `lotus_admin_get_app_access`
- `lotus_admin_update_app_access`

Admin tools require the server-side session/app access needed by the backing API. Creating apps uses
`POST /api/platform/apps`; access tools use `GET/PUT /api/apps/:appId/access`.

## Designer tools

- `lotus_designer_get_session`
- `lotus_designer_get_app_definitions`
- `lotus_designer_get_workflow`
- `lotus_designer_get_workflow_scaffold_options`
- `lotus_designer_create_document_type`
- `lotus_designer_scaffold_approval_workflow`
- `lotus_designer_preview_workflow_patch`
- `lotus_designer_apply_workflow_patch`
- `lotus_designer_validate_definition`
- `lotus_designer_export_template`
- `lotus_designer_validate_template`
- `lotus_designer_diff_template`
- `lotus_designer_apply_template`

Designer tools operate on replicated design documents and template artifacts through the existing
app-scoped APIs.

## Workspace tools

- `lotus_workspace_get_session`
- `lotus_workspace_get_app_definitions`
- `lotus_workspace_list_documents`
- `lotus_workspace_query_view`
- `lotus_workspace_get_document`
- `lotus_workspace_create_document`
- `lotus_workspace_update_document`
- `lotus_workspace_transition_document`

Workspace tools operate only on business documents and view results. They do not expose delete or
conflict-resolution tools in v1.

## Safety rules

- Every app-scoped tool requires an explicit `appId`.
- MCP tools never write directly to CouchDB.
- MCP tools never accept caller-supplied principals.
- Admin/design/workspace tools are exposed by separate MCP servers.
- Designer tools may mutate design documents; workspace tools may not.
- Workspace tools may mutate business document payload/state; admin/designer tools may not.
- MCP tools return structured errors from the Lotus API instead of hiding them.
- Mutating tools validate locally when possible and rely on the server as final authority.
