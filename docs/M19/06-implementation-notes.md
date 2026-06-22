# 06 - Implementation Notes

Implemented in commits:

- `816cc39` — M19 contract docs.
- `21d99fa` — shared system-app state, directory APIs, catalog card, Directory Console, and tests.

## Delivered behavior

- `GET /api/platform/state` now includes `systemApps`, with `setup.nsf` always advertised as the
  platform directory/system app.
- The catalog renders a System apps section and opens `setup.nsf`.
- `/setup.nsf` still renders first-run setup while setup is incomplete.
- After setup completes, authenticated admins open `/setup.nsf` as the Directory Console.
- Directory APIs are manager-protected and return sanitized People/Groups only.
- Admins can create people, edit display names, reset passwords, activate/deactivate users, create
  groups, and edit direct person membership.
- Deactivating a person deletes their active sessions from `platform_app`.
- The server rejects updates that would leave `group:admins` with no active member.
- `/api/reset` now recreates `setup_app` and `platform_app` before deterministic e2e seeding.

## Verification

- `npm run build`
- `npm run test:unit` — 10 files, 80 tests.
- `npm run test:e2e` — 58 tests.
- `npm run test:deploy`
