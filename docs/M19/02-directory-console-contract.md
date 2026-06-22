# 02 - Directory Console Contract

## Platform state

`GET /api/platform/state` adds:

```json
{
  "systemApps": [
    {
      "appId": "setup",
      "title": "Setup",
      "database": "setup_app",
      "route": "/setup.nsf",
      "description": "Directory, groups, and platform administration."
    }
  ]
}
```

System apps are always present and are not `appinstall:*` records.

## Directory response

`GET /api/setup/directory` returns sanitized directory data:

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

All M19 directory APIs require an authenticated manager session.

- `GET /api/setup/directory`
- `POST /api/setup/people`
- `PUT /api/setup/people/:username`
- `POST /api/setup/people/:username/password`
- `POST /api/setup/groups`
- `PUT /api/setup/groups/:slug`

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
