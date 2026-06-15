# 06 — Implementation Notes

## Implemented runtime behavior

M6 adds API-level template promotion:

- `POST /api/templates/export` creates a versioned `TemplateArtifact` from local definitions;
- `POST /api/templates/diff` compares a submitted template against local definitions;
- `POST /api/templates/apply` validates and writes template definitions to local CouchDB.

Templates include `app:config`, `acl:rules`, `form:*`, `view:*`, and `workflow:*`. They never include
business documents.

## Contract and diff

`src/shared/template.ts` provides shared helpers for:

- stripping `_rev` from exported definitions;
- sorting and normalizing definitions;
- document-level diff (`added`, `removed`, `changed`, `unchanged`);
- basic artifact validation.

The diff is intentionally document-level. Field-level diff and environment bind previews are deferred.

## Apply behavior

Apply is additive/update-only. Missing current definitions are reported by diff as `removed`, but the
apply route does not delete them. Each applied definition is written with the current local `_rev` if
one exists, so stale source-environment revisions are never reused.

`form:*`, `view:*`, and `workflow:*` definitions pass through `validateDesignDefinition`. `app:config`
and `acl:rules` receive minimal structural validation.

## Verification performed

```bash
npm run build
npx playwright test tests/e2e/template-promotion.spec.ts
npx playwright test tests/e2e/smoke.spec.ts
npm run test:e2e
```

The focused template promotion suite passed (`3 passed`). The first full-suite run had one transient
fixture/proxy failure where `/api/reset` returned `404` before a smoke test body ran; the smoke spec
passed on immediate rerun, and the final full e2e rerun passed (`27 passed`).

## Known limitations and risks

- Templates are API payloads only; there is no persisted template registry yet.
- ACL is exported/applied for demo completeness, but production promotion may need environment-bound
  ACL mapping.
- Promotion APIs have the same local-runtime trust posture as definition editing; there is no
  production admin authorization model yet.
- Apply does not delete missing definitions.
- Plugin packaging is out of scope.
