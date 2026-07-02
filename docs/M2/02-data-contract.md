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

(ADR-0019) Orthogonal to the datatype, a field may declare a computation `mode`:
absent = editable (user input); `computed` = server resolves the field's async-lane
`formula` (`@DbColumn`/`@DbLookup`) and stamps the payload on every write;
`computed-once` = resolve iff absent, never overwrite; `computed-for-display` =
per-request resolution, never stored (the former `type: "formula"`). Non-editable
values are server-owned — client-supplied values for them are discarded on every
write path — and computed modes reject `required`/`defaultValue`/`validate`/`compute`.

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

Form-level: `defaultReaders` (ADR-0015) — principal ids always added to a new document's
`readers` beyond the creator (e.g. `["group:finance"]`), so app-specific readers policy lives in
the template as data rather than in base code.

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

