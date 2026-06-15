# 03 — Authoring Runtime

## Studio model

The studio edits the same replicated definition documents the runtime already consumes:

- `form:*` for form fields and sections;
- `view:*` for columns, filters, and sort;
- `workflow:*` for states and transitions.

Structured controls update the JSON document in memory. Saving sends the whole definition through the
existing `PUT /api/definitions/:id` local-first endpoint.

## JSON escape hatch

The raw JSON editor remains available for developer-level edits and for definition fields the first
structured controls do not expose ergonomically. Both structured and raw edits pass through the same
shared validation before save.

## Conflict behavior

M4 keeps the M2/M3 conflict model. Definition documents replicate, can conflict, and are resolved by
the existing conflict inspector. There is no field-level merge for definitions in M4.

## Offline behavior

Authoring is offline-first: definitions are loaded from local CouchDB, saved to local CouchDB, and
replicated only when the user triggers sync.
