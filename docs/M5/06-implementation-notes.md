# 06 — Implementation Notes

> **Amended by ADR-0026 (2026-10-19):** per-document `readers` (and the M5 revocation purge) were removed — document visibility is the app ACL. Readers-based statements below are historical; see `docs/decisions/0026-app-acl-document-visibility.md`.

## Implemented runtime behavior

M5 centralizes the app/API access policy in `src/shared/access.ts` (M18 changes the source of these
principals from fixed config to authenticated sessions):

- effective principals are `[person, ...groups, ...principals]`;
- a business document is readable when one `readers` entry matches the actor's principals;
- payload edits and deletes require `authors` to include the actor's person id;
- workflow transitions require read access first, then the existing workflow guard/role check;
- new documents derive readers from the actor, with expense documents also visible to
  `group:finance` for approval.

The server now applies this policy to:

- `GET /api/documents`;
- `GET /api/views/:id/documents`;
- sourced select options from `GET /api/forms/:docType/options`;
- `PUT`/`DELETE /api/documents/:id`;
- `POST /api/documents/:id/transition`;
- conflict list/detail/resolve paths for business documents.

## Replication and purge

`POST /api/replicate` now runs with the current actor's principal scope. Push replication remains
unfiltered; pull replication is split into design metadata and business documents whose `readers`
match the actor.

After replication, the API compares local business documents with the server's currently visible
business-document ids for the actor. Any local document no longer readable is removed with CouchDB
`_purge`, not normal `DELETE`, so revocation does not replicate as a global server delete.

## Tests

`tests/e2e/acl.spec.ts` covers:

- Alice/Bob list scoping;
- sourced select options do not leak unreadable vendors;
- payload edits require authorship;
- workflow transitions fail with `403` before role checks when the actor cannot read the document;
- revocation purge removes the local revision while preserving the server document.

The existing workflow principal-gating test uses a Bob-authored readable document, so it still proves
Bob cannot approve without `group:finance` while no longer depending on Bob reading an Alice-only doc.

## Verification performed

```bash
npm run build
npx playwright test tests/e2e/acl.spec.ts
npx playwright test tests/e2e/workflow.spec.ts
npm run test:e2e
```

Original M5 e2e result: `24 passed`. Current M18 verification covers the updated policy in the full
suite.

The Tier-3 review workflow was attempted, but `.claude/workflows/review-change.js` failed to load
under Node with `SyntaxError: Illegal return statement`, so no automated review report was produced.

## Known limitations and risks

- M5 hardens the app/API path; direct local CouchDB admin access is still a development-only
  non-production boundary.
- The topology still uses one local app database in e2e/dev. Per-user local databases or a sync
  gateway remain future work.
- Push replication remains broad. Production needs a sync boundary that validates writes and prevents
  unauthorized stale revisions from being accepted.
- Purge is intentionally local-only; it solves revocation shape for the local replica, not global
  authorization.
