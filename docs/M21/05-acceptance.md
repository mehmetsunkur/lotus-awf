# 05 - Acceptance

M21 is accepted when:

- `/catalog.nsf` shows a create-app form to managers.
- Creating an app rejects reserved, duplicate, or invalid app ids.
- Creating an app writes local and server CouchDB databases.
- The catalog lists the new installed app.
- The new app opens at `/:appId.nsf` in the standard workspace.
- The new app has starter form/view definitions and can create/list/edit documents.
- The new app can create an additional document type from Designer.
- Template export for the new app includes its design docs and no business docs.
- Existing `expense.nsf`, `setup.nsf`, and `catalog.nsf` routes still work.
- Direct SPA routes for the new app are served by the deploy artifact.

## Verification

```bash
npm run build
npm run test:unit
npm run test:e2e
npm run test:deploy
```
