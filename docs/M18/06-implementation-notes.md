# 06 - Implementation Notes

Implemented in commits:

- `b65cb53` — M18 docs and directory/session ADR.
- `a4a7fda` — server-side directory documents, password hashing, sessions, and principal ACL checks.
- `5b81326` — login/logout client flow.
- `45a0740` — session-aware e2e/deploy tests.

## Delivered behavior

- `setup.nsf` is now the directory system app. It stores `person:*` and `group:*` documents in
  `setup_app`.
- `platform_app` stores `session:*` runtime documents keyed by a SHA-256 hash of an opaque session
  token.
- Passwords are hashed with Node `crypto.scrypt` and a per-person salt.
- `POST /api/session/login` verifies username/password and sets the HTTP-only `lotus_session`
  cookie. `POST /api/session/logout` clears the cookie and deletes the session when possible.
- `GET /api/session` and `GET /api/platform/state` return the current session state, including the
  public person, direct groups, effective principals, and app ACL level.
- Fresh setup creates the admin Person, `group:admins`, and an authenticated admin session.
- M19 adds the authenticated `setup.nsf` Directory Console on top of these directory documents.
- Installing the Expense sample seeds Alice/Bob demo people and groups, and adds the current
  installer to `group:finance` so the fresh admin can use the sample.
- App APIs now require authenticated sessions after setup and evaluate access from session-derived
  principals instead of the old fixed `APP_USER`.
- `acl:rules` now grants levels (`reader`, `author`, `editor`, `designer`, `manager`) to principals
  such as `person:alice` and `group:finance`.
- Direct group membership is supported; nested groups and offline login are deferred.

## Compatibility notes

- Existing Expense template/sample principals were migrated from `user:*`/`role:*` to
  `person:*`/`group:*`.
- Direct CouchDB access remains a development/deploy topology concern. The Express API is the
  enforced security boundary for remote users.
- E2E tests use separate authenticated request contexts for Alice and Bob. Cookies are scoped by host,
  not by port, so separate contexts are required when both API servers run on `localhost`.

## Verification

- `npm run build`
- `npm run test:unit` — 10 files, 80 tests.
- `npm run test:e2e` — 55 tests.
- `npm run test:deploy`
