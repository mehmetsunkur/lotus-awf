# 04 — Acceptance

M14 is accepted when:

- Fresh deploy readiness succeeds with `setup_app` and `platform_app` present.
- `GET /api/platform/state` reports `setupComplete: false` and no installed apps.
- The browser first shows `setup.nsf` / Lotus Platform Setup.
- Completing setup persists org/domain/admin and shows the app catalog.
- The app catalog initially says no business apps are installed.
- Installing the Expense sample creates an `appinstall:expense` record and seeds `expense_app`.
- Opening Expense shows the existing metadata runtime.
- The deploy gate verifies setup, empty catalog, sample install, CRUD, workflow, search, design
  mutation, agents, audit, template export, and replication.

## Verification

```bash
npm run build
npm run test:unit
npm run test:deploy
```
