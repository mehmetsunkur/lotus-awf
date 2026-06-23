# 02 - Tool Contract

## Configuration

The MCP server reads configuration from environment variables:

| Variable | Required | Meaning |
| --- | --- | --- |
| `LOTUS_API_URL` | no | Base API URL. Defaults to `http://localhost:3001`. |
| `LOTUS_USERNAME` | yes for protected tools | Login username. |
| `LOTUS_PASSWORD` | yes for protected tools | Login password. |

The MCP server uses the existing session-cookie login flow. It never accepts a client-supplied
principal and never bypasses app ACL checks.

## Read tools

- `lotus_get_session` returns the authenticated session state.
- `lotus_get_platform_state` returns setup, system apps, installed apps, samples, and session state.
- `lotus_list_apps` returns installed business apps from platform state.
- `lotus_get_app_definitions` returns app config, forms, views, workflows, roles, and access level.
- `lotus_get_workflow` returns one `workflow:<docType>` from an app.
- `lotus_get_workflow_scaffold_options` returns sanitized people/groups for workflow approvers.
- `lotus_export_template` exports current app design definitions.
- `lotus_diff_template` diffs a proposed template against the app's current definitions.

## Creation tools

- `lotus_create_document_type` wraps `POST /api/apps/:appId/document-types`.
- `lotus_scaffold_approval_workflow` wraps `POST /api/apps/:appId/workflows/scaffold`.

Both tools require server-side `designer` access and keep validation in the Express API.

## Validation tools

- `lotus_validate_definition` validates a single form/view/workflow/agent/audit policy definition.
- `lotus_validate_template` validates a template artifact and all eligible design definitions.

Validation tools are local and pure. Server routes still validate before writing.

## Workflow patch tools

- `lotus_preview_workflow_patch` fetches a workflow, applies patch operations in memory, validates the
  result, and returns the changed workflow plus a summary.
- `lotus_apply_workflow_patch` performs the same preview and writes the validated workflow through
  `PUT /api/apps/:appId/definitions/:id`.

Supported operations:

- `add_state`
- `update_state`
- `remove_state`
- `add_transition`
- `update_transition`
- `remove_transition`

Patch tools preserve existing definition ids and app ids. A remove-state operation must not leave a
transition pointing at the removed state and must not remove the initial state.

## Safety rules

- Every app-scoped tool requires an explicit `appId`.
- MCP tools never write directly to CouchDB.
- MCP tools never mutate business documents.
- MCP tools never mutate document `readers` or `authors`.
- MCP tools return structured errors from the Lotus API instead of hiding them.
- Mutating tools validate locally when possible and rely on the server as final authority.
