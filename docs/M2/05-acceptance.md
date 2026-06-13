# 05 — Acceptance

## Demo scenario

M2 should demonstrate this flow:

1. Start local CouchDB, server CouchDB, and the app runtime.
2. Reset/seed the M2 expense app.
3. Open the runtime and switch between multiple views.
4. Create or edit a vendor document.
5. Create an expense document using richer field types and the vendor select field.
6. Stop or disconnect server CouchDB.
7. Edit `form:expense` locally in the JSON definition editor.
8. Verify the local form changes immediately.
9. Create/edit an expense using the offline definition change.
10. Restart server CouchDB.
11. Sync local data and local definition changes to the server.
12. Edit a definition on the server and sync it back.
13. Force a conflict on a business document.
14. Force a conflict on a definition document.
15. Inspect and manually resolve both conflicts.

## Exit criteria

M2 is complete when the project can prove:

- richer forms are driven by replicated `form:*` documents;
- form validation works offline;
- simple expressions work offline;
- multiple document types coexist in one app database;
- views are driven by replicated `view:*` documents;
- runtime document lists use CouchDB indexes and `_find`;
- definition docs can be edited locally while offline;
- definition conflicts are surfaced and manually resolvable;
- M1 commands and acceptance path still work.

## Required written outcomes

The implementation should leave behind short notes covering:

- expression dialect and safety posture;
- form/view contract changes;
- local query/index strategy;
- definition editing behavior;
- definition conflict handling;
- known limitations and risks.

## M3 readiness

After M2, the project should have enough local form/view/runtime substrate to start M3 workflow:

- document lifecycle states;
- server-authoritative transitions;
- transition validation using the M2 expression runtime;
- offline data edits with online transitions by default.

