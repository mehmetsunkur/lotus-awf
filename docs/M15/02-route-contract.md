# 02 — Route Contract

## App routes

- `/setup.nsf`
- `/catalog.nsf`
- `/expense.nsf`

## Expense runtime routes

- `/expense.nsf/views/:viewSlug`
- `/expense.nsf/documents/:docId`
- `/expense.nsf/design/forms/:docType`
- `/expense.nsf/design/views/:viewSlug`
- `/expense.nsf/design/workflows/:docType`

## Mapping

- `view:my-expenses` -> `my-expenses`
- `form:expense` -> `expense`
- `workflow:expense` -> `expense`
- document ids are `encodeURIComponent` encoded.

`/expense.nsf` normalizes to `/expense.nsf/views/my-expenses`.

Unknown in-app routes normalize to `/expense.nsf/views/my-expenses`.
