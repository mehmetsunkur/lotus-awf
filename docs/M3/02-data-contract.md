# 02 — Data Contract

## Workflow definitions

M3 adds a third replicated definition kind alongside `form:*` and `view:*`:

```json
{
  "_id": "workflow:expense",
  "kind": "workflow",
  "appId": "expense",
  "docType": "expense",
  "title": "Expense Approval",
  "initialState": "draft",
  "states": [
    { "name": "draft", "label": "Draft" },
    { "name": "submitted", "label": "Submitted" },
    { "name": "approved", "label": "Approved", "final": true },
    { "name": "rejected", "label": "Rejected", "final": true }
  ],
  "transitions": [
    { "id": "submit", "label": "Submit", "from": "draft", "to": "submitted",
      "guard": "payload.amount > 0" },
    { "id": "approve", "label": "Approve", "from": "submitted", "to": "approved",
      "requiredRole": "role:finance" },
    { "id": "reject", "label": "Reject", "from": "submitted", "to": "rejected",
      "requiredRole": "role:finance" }
  ]
}
```

Fields:

- `initialState` — the state a document is treated as when it has no `state` yet.
- `states[]` — `{ name, label, final? }`. `final` states offer no outbound transitions.
- `transitions[]` — `{ id, label, from, to, guard?, requiredRole? }`.
  - `guard` is an M2 expression evaluated over `{ payload, doc, user, now }`; it must return truthy for
    the transition to be allowed.
  - `requiredRole` (optional) gates the transition to users holding that role in `acl:rules`.

`from` may be a single state name or `"*"` to allow the transition from any non-final state.

## Envelope state

The M2 `BusinessDocument` envelope gains four **optional** fields:

```json
{
  "state": "submitted",
  "stateUpdatedAt": "2026-06-14T10:00:00Z",
  "stateUpdatedBy": "user:alice",
  "history": [
    { "transition": "submit", "from": "draft", "to": "submitted",
      "at": "2026-06-14T10:00:00Z", "by": "user:alice" }
  ]
}
```

All four are optional. **A document with no `state` is treated as being in the workflow's
`initialState`** — this keeps every already-replicated M1/M2 document valid (aspect A1). The runtime
never writes `state` until the first transition, so historical docs are untouched until acted on.

Documents whose `docType` has no `workflow:*` definition behave exactly as in M2 (no state, no
actions).

## Indexes

M3 adds one Mango index for state-filtered worklists, created in all three index locations
(`scripts/seed.ts`, `scripts/reset.ts`, `seedTarget`/`ensureIndexes` in `src/server/index.ts`):

- `m3-docType-state-updatedAt` over `["docType", "state", "updatedAt"]`

The field order matches the worklist query shape — filter on `docType` + `state`, sort by `updatedAt`
(e.g. `view:pending-approvals`).

## Views

View filters already support arbitrary envelope fields, so a state worklist needs no contract change:

```json
{
  "_id": "view:pending-approvals",
  "kind": "view",
  "docType": "expense",
  "title": "Pending Approvals",
  "columns": [
    { "field": "payload.description", "label": "Description" },
    { "field": "payload.amount", "label": "Amount" },
    { "field": "state", "label": "State" }
  ],
  "filters": [
    { "field": "kind", "op": "eq", "value": "document" },
    { "field": "docType", "op": "eq", "value": "expense" },
    { "field": "state", "op": "eq", "value": "submitted" }
  ]
}
```
