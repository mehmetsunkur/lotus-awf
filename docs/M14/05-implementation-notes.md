# 05 — Implementation Notes

## Implemented behavior

- Added shared platform state types (`PlatformConfig`, `AppInstall`, `SampleApp`, `PlatformState`).
- Added `PLATFORM_DB` (`platform_app`) and `SETUP_DB` (`setup_app`) config.
- `APP_AUTO_SETUP=1` now seeds setup/platform databases, not Expense.
- Added `GET /api/platform/state`, `POST /api/platform/setup`, and
  `POST /api/platform/install-sample/expense`.
- Updated `/api/ready` to check setup/platform readiness and setup completion state.
- Added setup and catalog client modes before the existing Expense runtime mode.
- Added dependency-free client routing for `/setup.nsf`, `/catalog.nsf`, and `/expense.nsf`.
- Updated `npm run test:deploy` to verify fresh setup, empty catalog, explicit Expense sample install,
  and the prior runtime smoke.

## Verification performed

```bash
npm run build
npm run test:unit
```

`npm run test:deploy` is the required deploy gate for this milestone.

## Known limitations and risks

- Admin password hashing is development-only; there is no login/session enforcement yet.
- App catalog can install only the Expense sample.
- The existing Expense runtime was still single-app in M14; M20 later generalizes the client shell for
  `setup.nsf`, `catalog.nsf`, and `expense.nsf`.
- `/api/reset` remains a dev/e2e helper for the Expense sample.
