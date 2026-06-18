# 02 - Route Contract

## Runtime Routes

- `/expense.nsf`
- `/expense.nsf/views/:viewSlug`
- `/expense.nsf/documents/:docId`

`/expense.nsf` normalizes to `/expense.nsf/views/my-expenses`.

## Designer Routes

- `/expense.nsf/designer`
- `/expense.nsf/designer/forms/:docType`
- `/expense.nsf/designer/views/:viewSlug`
- `/expense.nsf/designer/workflows/:docType`

`/expense.nsf/designer` normalizes to the first editable definition.

## Unknown Routes

Unknown in-app routes, including old `/expense.nsf/design/...` paths, normalize to
`/expense.nsf/views/my-expenses`.

## Mapping

- `view:my-expenses` -> `my-expenses`
- `form:expense` -> `expense`
- `workflow:expense` -> `expense`
- document ids are `encodeURIComponent` encoded.

Direct document routes load the document by id from the local replica. They do not depend on the
document being present in the active view result set.
