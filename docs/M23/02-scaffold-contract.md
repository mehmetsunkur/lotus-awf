# 02 - Scaffold Contract

## Shared helper

`src/shared/workflow-scaffold.ts` owns the pure scaffold:

```ts
scaffoldApprovalWorkflow(appId, docType, title, approverPrincipal)
```

It returns one `workflow:*` definition and three `view:*` definitions. The server validates every
generated definition through `validateDesignDefinition` before writing.

## Generated workflow

- `_id`: `workflow:<docType>`
- `initialState`: `draft`
- states:
  - `draft`
  - `submitted`
  - `approved` (`final`)
  - `rejected` (`final`)
- transitions:
  - `submit`: `draft -> submitted`
  - `approve`: `submitted -> approved`, gated by `requiredRole: approverPrincipal`
  - `reject`: `submitted -> rejected`, gated by `requiredRole: approverPrincipal`
  - `revise`: `rejected -> draft`

## Generated views

- `view:<docType>-submitted`: filters `state == submitted`.
- `view:<docType>-mine`: app-readable list for the document type.
- `view:<docType>-all`: app-readable list for the document type.

All views sort by `updatedAt desc` and include title, state, and updated columns. M23 adds no new
Mango index; the submitted view uses the existing state worklist index.

## API

`GET /api/apps/:appId/workflows/scaffold-options`

Compatibility alias:

`GET /api/workflows/scaffold-options`

Returns active public people and public groups. Requires app `designer` access and does not expose
password hashes, salts, or session tokens.

`POST /api/apps/:appId/workflows/scaffold`

Compatibility alias:

`POST /api/workflows/scaffold`

Request body:

```json
{
  "docType": "report",
  "approverPrincipal": "group:finance"
}
```

Responses:

- `201 { workflow, views }` when written.
- `403` when the current app access is below `designer`.
- `404` when `form:<docType>` does not exist.
- `409` when `workflow:<docType>` or a generated view already exists.
- `422` for invalid doc type or approver principal.

Approver principals must be active `person:*` records or existing `group:*` records from `setup.nsf`.
