# 02 - Directory And Session Contract

## Person

`person:<username>` lives in `setup_app`.

```json
{
  "_id": "person:alice",
  "kind": "person",
  "username": "alice",
  "displayName": "Alice Finance",
  "active": true,
  "passwordHash": "...",
  "passwordSalt": "...",
  "passwordParams": {
    "algorithm": "scrypt",
    "keyLength": 64
  },
  "createdAt": "2026-06-22T00:00:00.000Z",
  "updatedAt": "2026-06-22T00:00:00.000Z"
}
```

Usernames are lowercase slugs for M18. `passwordHash` and `passwordSalt` are server-managed and are
never returned to the client.

## Group

`group:<slug>` lives in `setup_app`.

```json
{
  "_id": "group:finance",
  "kind": "group",
  "name": "Finance",
  "members": ["person:alice"]
}
```

M18 supports direct person membership only. Nested groups are deferred.

## Session

`session:<tokenHash>` lives in `platform_app`.

```json
{
  "_id": "session:...",
  "kind": "session",
  "personId": "person:alice",
  "createdAt": "2026-06-22T00:00:00.000Z",
  "expiresAt": "2026-06-23T00:00:00.000Z"
}
```

The browser receives only the opaque raw token in an HTTP-only cookie. The database stores a hash of
the token.

## APIs

- `POST /api/session/login` — username/password login; sets the session cookie.
- `POST /api/session/logout` — deletes the session when possible and clears the cookie.
- `GET /api/session` — returns the current person and effective principals, or `authenticated: false`.

## Public Routes

- `GET /api/health`
- `GET /api/ready`
- `GET /api/platform/state`
- `POST /api/platform/setup` while setup is incomplete
- `POST /api/session/login`
- built SPA routes and assets

All app/runtime mutation and data routes require a valid session.
