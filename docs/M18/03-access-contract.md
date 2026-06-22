# 03 - Access Contract

## Principal Resolution

An authenticated session resolves to:

```ts
{
  person: "person:alice",
  groups: ["group:finance"],
  principals: ["person:alice", "group:finance"],
  accessLevel: "manager"
}
```

The effective principal set is used for document `readers`, replication selectors, search narrowing,
audit visibility, and workflow action availability.

## App ACL

`acl:rules` remains an app design document but now grants access levels:

```json
{
  "_id": "acl:rules",
  "kind": "acl",
  "appId": "expense",
  "entries": [
    { "principal": "group:finance", "level": "manager" },
    { "principal": "person:bob", "level": "author" }
  ]
}
```

## Levels

M18 supports:

- `reader`
- `author`
- `editor`
- `designer`
- `manager`

Ordering is ascending. First enforcement:

- `reader+` can open/read app definitions and readable documents.
- `author+` can create business documents.
- `designer+` can edit definitions and scaffold document types.
- `manager` can install/manage apps.

Document `readers` and `authors` still govern row-level read/edit/delete access.

## Expense Principals

The Expense sample uses:

- `person:alice`
- `person:bob`
- `group:finance`
- `group:sales`

Finance-gated workflow transitions use `group:finance`.
