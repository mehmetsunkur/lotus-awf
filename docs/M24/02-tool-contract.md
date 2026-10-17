# 02 - Tool Contract

## Configuration

### Stdio servers

Each stdio MCP server reads the same configuration from environment variables:

| Variable | Required | Meaning |
| --- | --- | --- |
| `LOTUS_API_URL` | no | Base API URL. Defaults to `http://localhost:3001`. |
| `LOTUS_USERNAME` | yes for protected tools | Login username. |
| `LOTUS_PASSWORD` | yes for protected tools | Login password. |

### HTTP host

`src/mcp/http-server.ts` serves the same surfaces over HTTP and reads host-level configuration from
the environment (`src/mcp/http-config.ts`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOTUS_API_URL` | `http://localhost:3001` | Base API URL the host calls. |
| `MCP_HTTP_PORT` | `3002` | Listen port. |
| `MCP_HTTP_SURFACES` | `admin,designer,workspace` | Enabled surfaces. |
| `MCP_ALLOWED_HOSTS` | (unset) | Host-header allowlist (DNS-rebinding guard). |
| `MCP_ALLOWED_ORIGINS` | (unset) | Origin-header allowlist. |
| `MCP_SESSION_TTL_MS` | `1800000` | Idle session eviction window. |

The HTTP host takes **per-session** credentials on the `initialize` request via the `Authorization`
header — HTTP Basic (`username:password`) or Bearer (an existing `lotus_session` token) — instead of
process-wide env credentials.

Both transports use the existing session-cookie login flow. They never accept a client-supplied
principal as the acting identity and never bypass app ACL checks; the acting principal is always
resolved server-side.

## Surfaces

M24 exposes three non-layered MCP surfaces over two transports:

- `lotus-admin` (`src/mcp/admin-server.ts`) for platform/app lifecycle, app access, and the
  names.nsf directory.
- `lotus-designer` (`src/mcp/designer-server.ts`) for design definitions, workflows, and templates.
- `lotus-workspace` (`src/mcp/workspace-server.ts`) for business document work.

Over stdio, each surface is a separate process. Over HTTP, the single host (`src/mcp/http-server.ts`)
serves each surface at `/mcp/<surface>`, binding one authenticated identity per MCP session.

Users can register one or more surfaces depending on their role and task. The surfaces are
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

### Directory tools (names.nsf, ADR-0012)

- `lotus_admin_get_directory` — `GET /api/names/directory` (any authenticated person).
- `lotus_admin_create_person` — `POST /api/names/people`.
- `lotus_admin_update_person` — `PUT /api/names/people/:username` (`displayName`, `active`).
- `lotus_admin_set_person_password` — `POST /api/names/people/:username/password`.
- `lotus_admin_create_group` — `POST /api/names/groups`.
- `lotus_admin_update_group` — `PUT /api/names/groups/:slug`; `members` replaces the whole list.
- `lotus_admin_add_group_members` / `lotus_admin_remove_group_members` — read the group from the
  directory, merge (`src/mcp/directory-members.ts`), then `PUT` the full list. Last write wins; there
  is no revision check between read and write.

Writes are manager-only (`group:admins`), enforced by the server. The server also validates that
group members are existing `person:*` principals, refuses to leave `group:admins` without an active
member, and revokes a person's sessions on deactivation (including the calling MCP session if it
deactivates itself). Responses are sanitized `PublicPerson`/`PublicGroup`/`DirectoryState` shapes.

**Passwords are accepted as tool arguments** (`create_person`, `set_person_password`). They are
sensitive, write-only inputs: never returned by any tool, but they do appear in the agent's tool-call
transcript, so callers should treat that transcript accordingly. Directory deletion, nested groups,
and server-generated/one-time passwords are out of scope.

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
- MCP tools never accept a caller-supplied principal as the acting identity. Principals passed as
  data (ACL entries, workflow approvers, group members) are allowed; the server validates them and
  authorizes the write against the session's own access level.
- MCP tools never call `/api/reset`, `/api/setup`, or `/api/platform/setup`.
- Admin/design/workspace tools are exposed by separate MCP servers.
- Designer tools may mutate design documents; workspace tools may not.
- Workspace tools may mutate business document payload/state; admin/designer tools may not.
- MCP tools return structured errors from the Lotus API instead of hiding them.
- Mutating tools validate locally when possible and rely on the server as final authority.
- The HTTP host binds one authenticated identity per MCP session at `initialize`, rejects
  unauthenticated initialization, never shares a client across sessions, and adds no tool authority
  beyond the stdio surfaces.
