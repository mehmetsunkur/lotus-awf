# 05 — Acceptance

## Demo scenario

M4 should demonstrate this flow:

1. Start the local and server CouchDB pair and the runtime.
2. Reset/seed the app.
3. Edit `form:expense` with structured controls and save.
4. Confirm the form changes locally immediately.
5. Edit a `view:*` definition with structured controls and save.
6. Confirm the view changes locally immediately.
7. Edit `workflow:expense` with structured controls and save.
8. Confirm workflow actions/states reflect the changed definition.
9. Attempt to save an invalid definition and confirm it is rejected before write.
10. Sync and confirm definition documents still replicate normally.

## Exit criteria

M4 is complete when the project can prove:

- structured controls can edit form, view, and workflow definitions;
- invalid definitions are rejected on the client and API;
- definition edits save to the local replica and apply immediately;
- existing JSON editing remains available;
- definition conflict handling still uses the existing conflict inspector;
- M1-M3 acceptance paths still work.

## Required written outcomes

The implementation should leave notes covering:

- the validator scope and safety posture;
- how the studio maps to existing definition docs;
- known limitations and risks.
