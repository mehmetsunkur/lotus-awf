# 02 — Scaffold Contract

## docType rules (`src/shared/scaffold.ts`)

- `slugifyDocType(input)` — accent-fold (reusing `search.fold`), lowercase, non-alphanumeric → dashes,
  trim. Turns free text ("Purchase Order") into a candidate slug ("purchase-order").
- `validateDocType(docType)` — empty result means valid. Rejects: empty; not matching
  `^[a-z][a-z0-9-]*$` (lowercase slug, leading letter); or a **reserved** design-doc kind
  (`app/acl/form/view/workflow/agent/audit`). Uniqueness is enforced by the server (409), not here.

## The scaffold

`scaffoldDocumentType(appId, docType, title)` returns `{ form, view }`:

- **form** (`form:<docType>`): one `Details` section with a single required `title` text field.
- **view** (`view:<docType>`): one column on `payload.title`, sorted by `updatedAt` desc, no filters.

Both pass `validateFormDefinition` / `validateViewDefinition` (asserted in the unit tests). A new type
needs both — the form to edit a document, the view to list it and reach the form in the runtime — so the
scaffold always returns the pair. The title falls back to the docType when blank.

## API

```
POST /api/document-types  { docType, title }
  → 422 document_type_validation_failed   (bad slug / reserved)
  → 409 conflict                          (form:<docType> or view:<docType> exists)
  → 201 { form, view }                    (both written local-first)
```

The endpoint validates the slug, checks existence, scaffolds, validates both definitions with the shared
validators, then writes each via the existing upsert (`applyDefinition`). The scaffolded definitions are
ordinary design docs — they replicate and promote via the template artifact like any other.

## Generic document constructor

`createDocument(docType, payload, user, readers)` stamps `doc:<docType>:<ulid>` with the correct
`docType`. `POST /api/documents` uses it for any type; `createExpenseDoc`/`createVendorDoc` delegate to
it (their finance-readers default preserved). This removes the latent bug where a non-expense/vendor
type was mis-stamped as `expense`.

## Invariants honored

- **Validation parity**: both scaffolded definitions run through shared `validateDesignDefinition`
  before the write.
- **ACL / readers**: scaffolded docs are design docs (no readers); new-type documents get actor-scoped
  readers via `readersForNewDocument`.
- **Index & query**: no new Mango index; the list view's `updatedAt` sort binds `m2-kind-docType-updatedAt`.
- **Definitions-as-data contract**: new definitions only; no existing shape changed.
- **Offline editing**: scaffold writes and reads go to the local node.
