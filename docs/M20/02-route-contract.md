# 02 - Route Contract

## Generic NSF Routes

The client treats `.nsf` paths as app routes:

- `/:appSlug.nsf`
- `/:appSlug.nsf/views/:viewSlug`
- `/:appSlug.nsf/documents/:docId`
- `/:appSlug.nsf/new/:docType`
- `/:appSlug.nsf/designer`
- `/:appSlug.nsf/designer/forms/:docType`
- `/:appSlug.nsf/designer/views/:viewSlug`
- `/:appSlug.nsf/designer/workflows/:docType`

M20 applies the full metadata document/designer route set to `expense.nsf`. System apps use the same
top-level shell and view route shape, but their right panes may host specialized panels.

## First-Party Apps

- `/setup.nsf` opens the setup system app.
- `/catalog.nsf` opens the platform catalog system app.
- `/expense.nsf` opens the installed Expense business app.
- `/login.nsf` remains a special authentication route and is not rendered in the app workspace.

## Default Views

- `/setup.nsf` normalizes to `/setup.nsf/views/people`.
- `/catalog.nsf` normalizes to `/catalog.nsf/views/system-apps`.
- `/expense.nsf` normalizes to `/expense.nsf/views/my-expenses`.

Unknown system-app routes normalize to that app's default view. Unknown Expense app routes preserve
the M16 behavior and normalize to `/expense.nsf/views/my-expenses`.
