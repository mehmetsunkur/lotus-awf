# 03 — Runtime Flow

The built client starts with `GET /api/platform/state`.

## Canonical routes

- `/setup.nsf` — first-run setup.
- `/login.nsf` — username/password login after setup.
- `/catalog.nsf` — platform app catalog.
- `/expense.nsf` — installed Expense sample runtime.
- `/` — compatibility entry; client routing replaces it with setup or catalog after platform state
  loads.

## Modes

1. `setupComplete: false` -> navigate/render `/setup.nsf`.
2. `setupComplete: true` and `session.authenticated: false` -> navigate/render `/login.nsf`.
3. `setupComplete: true` and setup/login route requested while authenticated -> navigate/render
   `/catalog.nsf`.
4. User opens installed Expense sample -> navigate/render `/expense.nsf`.
5. Direct `/expense.nsf` before sample install -> return to `/catalog.nsf`.

The current Expense runtime remains single-app and uses the existing `expense_app` APIs. M14 does not
introduce general multi-app routing.

## Fresh deploy

`deploy/compose.yml` sets `APP_AUTO_SETUP=1`. On boot the server:

1. waits for both CouchDB replicas;
2. creates `setup_app` and `platform_app` if missing;
3. seeds `setup_app/app:config`;
4. seeds `platform_app/platform:config` with `setupComplete: false`;
5. does **not** seed `expense_app`.

This means a fresh browser load shows setup, not the Expense sample.

Submitting setup creates the admin `person:*`, `group:admins`, and a session cookie. After setup,
all app/runtime/design APIs require that authenticated session; unauthenticated callers are sent to
`/login.nsf` by the client and receive `401` from protected APIs.
