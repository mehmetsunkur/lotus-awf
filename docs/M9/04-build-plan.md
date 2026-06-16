# 04 — Build Plan

## Step 1 — Contract + pure matcher

Add `searchable?: boolean` to `FormField` (`src/shared/types.ts`) and validate it in
`src/shared/definition-validation.ts`. Add `src/shared/search.ts` (`fold`, `tokenize`,
`searchableFields`, `scoreDocument`, `searchDocuments`). Unit-test (folding, AND-of-terms, prefix,
ranking, empty-query passthrough, non-searchable exclusion, validation).

## Step 2 — Server endpoint + seed

Apply `searchDocuments` in `GET /api/views/:id/documents?q=` **after** the `canReadDocument` filter,
loading the view's form from the local node only when `q` is present. Mark seed expense `description`
searchable and exclude the opaque `vendorId` select.

## Step 3 — Client search box + e2e

Add the per-view search box to `src/client/main.tsx` (committed-query ref; submit/clear refetch).
Add `tests/e2e/search.spec.ts`: filtering narrows + clear restores, score ordering, and an ACL
assertion that a scoped user's search never surfaces an unauthorized document.

## Step 4 — Docs

Add these M9 docs and `docs/decisions/0004-search-as-shared-matcher.md`; add the Search invariant
(with `Paths:`); reconcile the `docs/context/*` cards and bump their baselines.

## Step 5 — Verify

`npm run build`, `npm run test:unit`, `npm run test:e2e`.
