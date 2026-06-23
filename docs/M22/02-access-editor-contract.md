# 02 - Access Editor Contract

## API

`GET /api/apps/:appId/access`

- Requires app `manager` access.
- Returns current `acl:rules.entries`.
- Returns active people and existing groups from `setup.nsf`.
- Does not expose password hashes, salts, or session tokens.

`PUT /api/apps/:appId/access`

- Requires app `manager` access.
- Accepts a replacement entry list.
- Writes the selected app's `acl:rules` design document in the local app database.

Request body:

```json
{
  "entries": [
    { "principal": "person:bob", "level": "author" },
    { "principal": "group:finance", "level": "manager" }
  ]
}
```

## Validation

- Principal must be an active `person:*` or an existing `group:*`.
- Level must be one of `reader`, `author`, `editor`, `designer`, or `manager`.
- `none` is not stored; remove the entry to revoke.
- Duplicate principals are normalized to one entry; the last submitted level wins.

## Last Manager Rule

An update is rejected when no active person can still manage the app.

A manager can come from:

- a direct active `person:*` entry with `manager`
- a `group:*` entry with `manager` and at least one active member
- the global `group:admins` platform override, as long as it has at least one active member

## Document Visibility

Changing app ACL does not mutate existing business document `readers` or `authors`. App access grants
the ability to open/create/design/manage according to level; row-level visibility remains
per-document.
