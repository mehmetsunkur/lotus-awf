# 03 — Runtime Flow

The built client starts with `GET /api/platform/state`.

## Modes

1. `setupComplete: false` -> render setup screen (`setup.nsf`).
2. `setupComplete: true` and no opened app -> render app catalog.
3. User opens installed Expense sample -> render the existing metadata runtime.

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
