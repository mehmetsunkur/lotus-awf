# 05 - Implementation Notes

## Implemented Behavior

- Added `templates/expense/template.json` as the checked-in `sample:expense` design artifact.
- Added `templates/expense/sample-data.json` as separate optional demo business data.
- Added `src/server/template-registry.ts`, a filesystem-backed registry that loads and validates
  sample template files.
- `seedDocuments()` now loads `sample:expense` from the registry, preserving `scripts/seed.ts`,
  `scripts/reset.ts`, `/api/setup`, `/api/reset`, and e2e fixture compatibility.
- `/api/platform/install-sample/expense` installs the same JSON-backed sample through the existing
  seed path and records `appinstall:expense` in `platform_app`.
- `Dockerfile` copies `templates/` into the packaged image so deploy installs do not depend on a
  source bind mount.
- The deploy gate asserts the stable `doc:expense:stationery` sample record exists after install.

## Verification Performed

```bash
npm run build
npm run test:unit
```

`npm run test:deploy` remains the final deploy gate for this milestone.

## Known Limitations And Risks

- The registry is filesystem-backed and contains only `sample:expense`; remote registry, upload,
  rollback, and multi-sample catalog flows remain future work.
- Installing the Expense sample still installs demo data because this is a sample install. Template
  promotion APIs remain design-only.
- Handler implementations still ship with the runtime/plugin layer; JSON templates reference handlers
  by manifest name.
