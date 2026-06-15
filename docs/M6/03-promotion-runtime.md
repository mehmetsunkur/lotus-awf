# 03 — Promotion Runtime

## Export

`POST /api/templates/export` returns the current local definitions as a `TemplateArtifact`.

The request may provide `version` and `source`; otherwise the API generates a timestamp version and
uses `local` as the source label.

## Diff

`POST /api/templates/diff` compares the submitted template definitions against current local
definitions by `_id`. It returns:

- `added`
- `removed`
- `changed`
- `unchanged`

The comparison strips `_rev` and uses stable JSON. It is document-level, not field-level.

## Apply

`POST /api/templates/apply` validates the artifact and writes each included definition to local
CouchDB. Apply is additive/update-only: missing current definitions are reported by diff but not
deleted.

Apply does not touch business documents.
