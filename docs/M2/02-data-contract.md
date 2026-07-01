# 02 — Data Contract

## Business documents

M2 keeps the M1 envelope:

```json
{
  "_id": "doc:expense:01J00000000000000000000000",
  "kind": "document",
  "appId": "expense",
  "docType": "expense",
  "createdAt": "2026-06-12T21:00:00Z",
  "updatedAt": "2026-06-12T21:00:00Z",
  "createdBy": "user:alice",
  "updatedBy": "user:alice",
  "readers": ["user:alice", "role:finance"],
  "authors": ["user:alice"],
  "payload": {}
}
```

M2 adds a second document type:

```text
doc:vendor:<ulid>
form:vendor
view:vendors
```

Expenses may reference vendors with a simple `vendorId` payload field. M2 does not enforce
referential integrity.

## Form definitions

M2 form definitions remain replicated documents:

```json
{
  "_id": "form:expense",
  "kind": "form",
  "appId": "expense",
  "docType": "expense",
  "title": "Expense",
  "sections": [
    {
      "title": "Details",
      "fields": ["amount", "description", "vendorId"]
    }
  ],
  "fields": [
    {
      "name": "amount",
      "type": "number",
      "label": "Amount",
      "required": true,
      "validate": [
        { "expression": "payload.amount > 0", "message": "Amount must be greater than zero" }
      ]
    },
    {
      "name": "vendorId",
      "type": "select",
      "label": "Vendor",
      "source": { "docType": "vendor", "labelField": "payload.name" }
    }
  ]
}
```

Supported field types:

- `text`
- `textarea`
- `number`
- `date`
- `boolean`
- `select`
- `formula` (ADR-0014) — read-only, server-resolved via the async formula lane
  (`@DbColumn`/`@DbLookup`), and excluded from the stored payload.

Supported field behavior:

- `required`
- `requiredWhen`
- `visibleWhen`
- `readOnlyWhen`
- `defaultValue`
- `helpText`
- `options`
- `source`
- `validate`

M1 form documents remain valid.

## View definitions

M2 supports multiple replicated view documents:

```json
{
  "_id": "view:all-expenses",
  "kind": "view",
  "appId": "expense",
  "docType": "expense",
  "title": "All Expenses",
  "columns": [
    { "field": "payload.description", "label": "Description" },
    { "field": "payload.amount", "label": "Amount" }
  ],
  "filters": [
    { "field": "kind", "op": "eq", "value": "document" },
    { "field": "docType", "op": "eq", "value": "expense" }
  ],
  "sort": [
    { "field": "updatedAt", "direction": "desc" }
  ]
}
```

M2 uses structured filters by default. Expression filters can come later.

## Indexes

M2 creates Mango indexes for runtime lists:

- `kind`
- `docType`
- `updatedAt`
- `readers`

The runtime should use `_find` for business document lists instead of scanning all documents.

