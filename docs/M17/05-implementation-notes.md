# 05 - Implementation Notes

## Implemented Behavior

- Added `templates/expense/template.json` as the checked-in `sample:expense` design artifact.
- Added `templates/expense/sample-data.json` as separate optional demo business data.
- Added `templates/org/template.json` and `templates/org/sample-data.json` as a checked-in
  organization-structure template. It models departments, employees, and reporting lines only; derived
  directory groups are deferred until a generic data-driven write mechanism exists.
- Added `src/server/template-registry.ts`, a filesystem-backed registry that loads and validates
  sample template files.
- `seedDocuments()` now loads `sample:expense` from the registry, preserving `scripts/seed.ts`,
  `scripts/reset.ts`, `/api/setup`, `/api/reset`, and e2e fixture compatibility.
- ADR-0016 installs bundled templates through `POST /api/platform/apps { appId, title, fromTemplate }`;
  the old `/api/platform/install-sample/*` route is not part of the current contract.
- `Dockerfile` copies `templates/` into the packaged image so deploy installs do not depend on a
  source bind mount.
- The deploy gate asserts the stable `doc:expense:stationery` sample record exists after install.

## Verification Performed

```bash
npm run build
npm run test:unit
npm run test:deploy
```

## Known Limitations And Risks

- The registry is filesystem-backed and contains `sample:expense` and `sample:org`; remote registry,
  upload, rollback, and user-exported catalog flows remain future work.
- Creating an app from a bundled template installs demo data. Template promotion APIs remain
  design-only.
- Handler implementations still ship with the runtime/plugin layer; JSON templates reference handlers
  by manifest name.
