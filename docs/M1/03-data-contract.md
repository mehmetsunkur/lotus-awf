# 03 — Data Contract

## ID conventions

Use predictable document ID prefixes so the runtime can separate business data from definitions.

Initial convention:

```text
app:config
doc:<docType>:<id>
form:<docType>
view:<viewName>
acl:rules
```

Business document IDs should be client-generated. Prefer UUIDv7 or ULID so offline-created documents
do not collide.

## Business document envelope

Every business document has a stable envelope and a schema-free payload:

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
  "payload": {
    "amount": 125.5,
    "description": "Train ticket"
  }
}
```

The envelope is for platform behavior: identity, permissions, listing, conflict display, and later
workflow. The payload is application-specific data.

## Form definition

Form definitions are replicated documents:

```json
{
  "_id": "form:expense",
  "kind": "form",
  "appId": "expense",
  "docType": "expense",
  "title": "Expense",
  "fields": [
    { "name": "amount", "type": "number", "label": "Amount", "required": true },
    { "name": "description", "type": "text", "label": "Description" }
  ]
}
```

M1 only needs basic field rendering. Conditional rules, computed fields, and advanced validation can
come later.

## View definition

View definitions are replicated documents:

```json
{
  "_id": "view:my-expenses",
  "kind": "view",
  "appId": "expense",
  "docType": "expense",
  "title": "My Expenses",
  "columns": [
    { "field": "payload.description", "label": "Description" },
    { "field": "payload.amount", "label": "Amount" },
    { "field": "updatedAt", "label": "Updated" }
  ],
  "sort": [
    { "field": "updatedAt", "direction": "desc" }
  ]
}
```

M1 can implement simple local filtering by `kind` and `docType`, then render configured columns.

## Conflict handling contract

M1 should preserve CouchDB conflicts and surface them in the runtime.

Minimum behavior:

- detect documents with conflicts;
- fetch conflicting revisions;
- show the winning revision and conflicting revisions;
- let a user save a new resolved document revision;
- document how losing conflict revisions are cleared or retained.

Automatic merging is not required for M1.

