# 06 - Implementation Notes

## Implemented

- Added shared app-id validation and blank app scaffolding in `src/shared/app-scaffold.ts`.
- Added `POST /api/platform/apps` to create a local/server CouchDB database, seed starter design
  docs, create app indexes, and record `appinstall:<appId>` in `platform_app`.
- Parameterized CouchDB helpers and runtime server helpers so metadata, documents, conflicts,
  replication, agents, audit, and templates can target an app database.
- Added app-scoped runtime APIs under `/api/apps/:appId/...`.
- Preserved unscoped Expense APIs as compatibility aliases.
- Generalized client `.nsf` routing so installed business app slugs open through the standard M20
  runtime/designer workspace.
- Added catalog create-app UI in `/catalog.nsf/views/installed-apps`.
- Added unit coverage for app scaffold helpers, e2e source coverage for catalog-created apps, and
  deploy-gate assertions for app-scoped APIs.

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
