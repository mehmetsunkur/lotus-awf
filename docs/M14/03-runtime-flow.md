# 03 — Runtime Flow

The built client starts with `GET /api/platform/state`.

## Canonical routes

- `/setup.nsf` — first-run setup before setup completes; after setup, redirects to `names.nsf`.
- `/names.nsf` — authenticated Directory Console system app in the standard NSF workspace.
- `/login.nsf` — username/password login after setup.
- `/catalog.nsf` — platform app catalog in the standard NSF workspace.
- `/expense.nsf` — installed Expense sample runtime.
- `/` — compatibility entry; client routing replaces it with setup or catalog after platform state
  loads.

## Modes

1. `setupComplete: false` -> navigate/render `/setup.nsf` first-run setup.
2. `setupComplete: true` and `session.authenticated: false` -> navigate/render `/login.nsf`.
3. `setupComplete: true` and login route requested while authenticated -> navigate/render
   `/catalog.nsf`.
4. `setupComplete: true` and `/setup.nsf` requested while authenticated -> redirect to `/names.nsf`.
5. User opens installed Expense sample -> navigate/render `/expense.nsf`.
6. Direct `/expense.nsf` before sample install -> return to `/catalog.nsf`.

M20 supersedes the original one-off M14 system pages by rendering `names.nsf`, `catalog.nsf`, and
`expense.nsf` in the standard two-pane NSF workspace. Expense still uses the existing `expense_app`
metadata APIs.

## Fresh deploy

`deploy/compose.yml` sets `APP_AUTO_SETUP=1`. On boot the server:

1. waits for both CouchDB replicas;
2. creates `names_app` and `platform_app` if missing;
3. seeds `names_app/app:config`;
4. seeds `platform_app/platform:config` with `setupComplete: false`;
5. does **not** seed `expense_app`.

This means a fresh browser load shows setup, not the Expense sample.

Submitting setup creates the admin `person:*`, `group:admins`, and a session cookie. After setup,
all app/runtime/design APIs require that authenticated session; unauthenticated callers are sent to
`/login.nsf` by the client and receive `401` from protected APIs.

The catalog always shows `names.nsf` under System apps. Business apps remain separate `appinstall:*`
records.
