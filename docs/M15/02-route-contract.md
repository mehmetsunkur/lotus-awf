# 02 — Route Contract

## App routes

- `/setup.nsf`
- `/catalog.nsf`
- `/expense.nsf`

## Expense runtime routes

- `/expense.nsf/views/:viewSlug`
- `/expense.nsf/documents/:docId`
- `/expense.nsf/design/forms/:docType` (superseded by M16)
- `/expense.nsf/design/views/:viewSlug` (superseded by M16)
- `/expense.nsf/design/workflows/:docType` (superseded by M16)

M16 removes `/design/...` compatibility from the active route model. Designer routes use
`/expense.nsf/designer/...`.

## Mapping

- `view:my-expenses` -> `my-expenses`
- `form:expense` -> `expense`
- `workflow:expense` -> `expense`
- document ids are `encodeURIComponent` encoded.

`/expense.nsf` normalizes to `/expense.nsf/views/my-expenses`.

Unknown in-app routes normalize to `/expense.nsf/views/my-expenses`.
