# 02 — Platform Contract

## Databases

- `setup_app` — first-run setup and directory system app. Seeded with `app:config` (`appId:
  "setup"`, title `"Setup"`) and M18 `person:*` / `group:*` directory documents.
- `platform_app` — platform control state and M18 `session:*` runtime documents.
- `expense_app` — optional sample business app, installed only after setup.

## Platform documents

`platform:config`:

```json
{
  "_id": "platform:config",
  "kind": "platformconfig",
  "setupComplete": false
}
```

After setup it stores `orgName`, `domainName`, and `adminUser`. Password hashes live on
`person:*` documents in `setup_app`.

`appinstall:<appId>`:

```json
{
  "_id": "appinstall:expense",
  "kind": "appinstall",
  "appId": "expense",
  "title": "Expense sample",
  "database": "expense_app",
  "templateId": "sample:expense"
}
```

`systemApps` in `GET /api/platform/state`:

```json
[
  {
    "appId": "setup",
    "title": "Setup",
    "database": "setup_app",
    "route": "/setup.nsf",
    "description": "Directory, groups, and platform administration."
  }
]
```

System apps are always present platform apps, not installable business app records.

## APIs

- `GET /api/platform/state` — setup state, system apps, installed apps, available samples, and
  current session.
- `POST /api/platform/setup` — validates and stores org/domain/admin setup, creates the admin
  Person and `group:admins`, and sets the session cookie.
- `POST /api/platform/install-sample/:appId` — installs a registered sample template (e.g.
  `expense`) after setup; generic and registry-driven (ADR-0015). Expense is no longer a base
  specialization — it resolves and installs like any app; business runtime is app-scoped only
  (`/api/apps/:appId/*`).
- `GET /api/session` — returns public session state.
- `POST /api/session/login` — username/password login; sets the HTTP-only `lotus_session` cookie.
- `POST /api/session/logout` — clears the session cookie and deletes the session if present.
- `GET /api/ready` — checks CouchDB, `setup_app`, and `platform_app`; it does not require Expense.

## Security posture

M18 replaces M14's placeholder password flow with first-party username/password login backed by
directory Person documents. Passwords are salted and hashed with Node `crypto.scrypt`; sessions are
opaque tokens stored as hashes in `platform_app` and carried by an HTTP-only cookie.

This is still a first-party platform auth layer, not OIDC/LDAP. External identity integration,
password reset, policy controls, and offline login remain future work.
