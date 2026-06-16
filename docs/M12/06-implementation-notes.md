# 06 — Implementation Notes

## Implemented behavior

M12 adds the create-from-scratch path:

- a pure scaffold (`src/shared/scaffold.ts`) — `slugifyDocType`, `validateDocType`, and
  `scaffoldDocumentType` which builds a starter form + list view that pass the shared validators;
- `POST /api/document-types {docType, title}` — 422 bad slug, 409 existing type, validate both, write
  via the existing upsert;
- a generic `createDocument(docType, …)` so any scaffolded type's documents are stamped correctly
  (expense/vendor constructors delegate to it);
- a "New document type" form in the studio that surfaces the new type immediately.

## Architecture

The scaffold is pure and portable (`src/shared/scaffold.ts`), unit-tested, exactly like the
search/audit/agent/form-layout engines; the server validates and writes around it, reusing the upsert
that template apply already uses. No new endpoint machinery, no new Mango index — the scaffolded list
view's `updatedAt` sort binds the existing `m2-kind-docType-updatedAt`.

## Correctness and back-compat

Both scaffolded definitions run through shared `validateDesignDefinition` before the write
(parity). The generic constructor fixes a latent bug where a non-expense/vendor docType was mis-stamped
as `expense`; `createExpenseDoc`/`createVendorDoc` now delegate to it with unchanged behavior, and the
expense/vendor e2e specs pass. Scaffolded definitions promote via the template artifact unchanged.

## Verification performed

```bash
npm run build                                       # tsc --noEmit + vite build
npm run test:unit                                   # scaffold engine + slug rules
npx playwright test tests/e2e/document-types.spec.ts # scaffold, list, 409, 422, promotion
npx playwright test tests/e2e/expense.spec.ts tests/e2e/vendor.spec.ts  # generic constructor regression
npm run test:e2e                                    # full suite
```

## Known limitations and risks

- No workflow scaffold — new types are state-less (the runtime's back-compat path).
- The starter form is minimal (one `title` field); the citizen then shapes it with the M11 layout studio.
- Single-app: `appId` comes from `app:config`; deleting/renaming a type is not supported.
- `POST /api/document-types` has the same non-production auth posture as the other write endpoints.
