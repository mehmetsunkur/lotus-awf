# 02 - Directory Console Contract

## Platform state

`GET /api/platform/state` adds:

```json
{
  "systemApps": [
    {
      "appId": "names",
      "title": "Directory",
      "database": "names_app",
      "route": "/names.nsf",
      "description": "People, groups, and directory administration."
    }
  ]
}
```

System apps are always present and are not `appinstall:*` records.

## Directory response

`GET /api/names/directory` returns sanitized directory data:

```json
{
  "people": [
    {
      "_id": "person:alice",
      "kind": "person",
      "username": "alice",
      "displayName": "Alice Finance",
      "active": true
    }
  ],
  "groups": [
    {
      "_id": "group:finance",
      "kind": "group",
      "name": "Finance",
      "members": ["person:alice"]
    }
  ],
  "installedApps": []
}
```

Password hashes, salts, and session tokens are never returned.

## APIs

`GET /api/names/directory` requires an active authenticated session and is readable by every logged-in
person. Directory mutations require an authenticated manager session.

- `GET /api/names/directory`
- `POST /api/names/people`
- `PUT /api/names/people/:username`
- `POST /api/names/people/:username/password`
- `POST /api/names/groups`
- `PUT /api/names/groups/:slug`

People:

- Create requires `username`, `displayName`, and `password`.
- Username is normalized and immutable after creation.
- Update accepts `displayName` and `active`.
- Password reset accepts `password`.
- Deactivating a person deletes that person's sessions from `platform_app`.

Groups:

- Create requires `slug`, `name`, and optional `members`.
- Group slug is normalized and immutable after creation.
- Update accepts `name` and `members`.
- M19 supports direct `person:*` members only.

Lockout protection:

- The API rejects updates that would leave `group:admins` with no active member.
