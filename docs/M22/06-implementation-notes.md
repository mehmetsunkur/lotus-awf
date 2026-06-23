# 06 - Implementation Notes

## Implemented

- Added shared `AppAccessState`, `AppAccessUpdate`, and `AppAccessEntry` types.
- Added app-scoped `GET /api/apps/:appId/access` and `PUT /api/apps/:appId/access`.
- Access API requires app `manager`, validates active `person:*` / existing `group:*` principals,
  accepts only `reader` / `author` / `editor` / `designer` / `manager`, and normalizes duplicate
  principals.
- Access API rejects updates that leave no active manager, while preserving the global
  `group:admins` platform override.
- Added a business app Designer Access panel at `/:appId.nsf/designer/access`.
- Hid runtime Designer entry points and redirected direct Designer routes for users below
  `designer` access.
- Added e2e and deploy-source coverage for granting app access without widening existing document
  visibility.

## Verification

Passed:

```bash
npm run build
npm run test:unit
```

Could not run in this environment:

```bash
npx playwright test tests/e2e/catalog-apps.spec.ts
npm run test:e2e
npm run test:deploy
```

Reason: Docker socket access is denied in this session, and the CouchDB ports required by the e2e
topology (`localhost:5984`, `localhost:5985`) are not reachable.
