# 02 — Platform Contract

## Databases

- `setup_app` — first-run setup app marker. Seeded with `app:config` (`appId: "setup"`, title
  `"Setup"`).
- `platform_app` — platform control state.
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

After setup it stores `orgName`, `domainName`, `adminUser`, and a development-only password hash.

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

## APIs

- `GET /api/platform/state` — setup state, installed apps, and available samples.
- `POST /api/platform/setup` — validates and stores org/domain/admin setup.
- `POST /api/platform/install-sample/expense` — installs the Expense sample after setup.
- `GET /api/ready` — checks CouchDB, `setup_app`, and `platform_app`; it does not require Expense.

## Security posture

The admin password is captured to shape the correct product flow, but M14 does not implement real auth.
The stored hash is development-only and must be replaced by a real identity/session subsystem before
production use.
