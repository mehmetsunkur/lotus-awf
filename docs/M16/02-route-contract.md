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

## Compatibility Routes

The old M15 design routes remain accepted and normalize with `history.replaceState`:

- `/expense.nsf/design/forms/:docType` -> `/expense.nsf/designer/forms/:docType`
- `/expense.nsf/design/views/:viewSlug` -> `/expense.nsf/designer/views/:viewSlug`
- `/expense.nsf/design/workflows/:docType` -> `/expense.nsf/designer/workflows/:docType`

## Mapping

- `view:my-expenses` -> `my-expenses`
- `form:expense` -> `expense`
- `workflow:expense` -> `expense`
- document ids are `encodeURIComponent` encoded.
