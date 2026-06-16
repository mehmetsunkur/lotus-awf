# 04 — Build Plan

## Step 1 — Pure scaffold engine

Add `src/shared/scaffold.ts` (`slugifyDocType`, `validateDocType`, `scaffoldDocumentType`). Unit-test
that the scaffolded form + view pass the shared validators and that slug rules reject empty / non-slug /
reserved types.

## Step 2 — Server: generic constructor + scaffold endpoint

Add `createDocument(docType, …)` to `seed-data.ts` and route `POST /api/documents` through it
(expense/vendor delegate). Add `definitionExists` and `POST /api/document-types` (422 slug, 409 exists,
validate both, upsert). No new Mango index.

## Step 3 — Client: New-type form + e2e

Add the "New document type" form to `DefinitionEditor` (`onCreateType` → `POST /api/document-types`),
pointing the studio + picker at the new type on success. Add `tests/e2e/document-types.spec.ts`:
scaffold via UI → view appears → create a document → it lists; 409 duplicate; 422 bad slug; template
promotion.

## Step 4 — Docs

Add these M12 docs and `docs/decisions/0007-document-type-scaffold.md`; add the Document-type creation
invariant (with `Paths:`); reconcile the `docs/context/*` cards and bump baselines.

## Step 5 — Verify

`npm run build`, `npm run test:unit`, `npm run test:e2e`. (No Tier-3 review — a create path, no
substrate change.)
