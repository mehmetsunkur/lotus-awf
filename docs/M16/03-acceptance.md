# 03 - Acceptance

M16 is accepted when:

- `/expense.nsf` renders the runtime workspace.
- Runtime left pane lists all view definitions.
- Runtime left pane lists form-backed create actions.
- Selecting a view updates the URL and right pane.
- Selecting a create action opens a new document form for that `docType`.
- Document rows expose a new-tab document link.
- `Open in Designer` opens `/expense.nsf/designer` in a new browser tab.
- `/expense.nsf/designer/views/all-expenses` opens Designer with that view selected.
- Designer left pane lists forms, views, and workflows.
- Selecting a Designer item updates the URL and editor selection.
- `/expense.nsf/design/forms/expense` normalizes to `/expense.nsf/designer/forms/expense`.
- Existing runtime save, workflow, conflict, and definition-save flows keep working.

## Verification

```bash
npm run build
npm run test:unit
npm run test:e2e
npm run test:deploy
```
