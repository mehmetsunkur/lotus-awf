# 03 — Create Runtime

## The endpoint

`POST /api/document-types` is the create path the studio calls:

```
POST /api/document-types { docType, title }
  → validateDocType(docType)                 // 422 on bad slug / reserved kind
  → definitionExists(form:<docType> | view:<docType>)  // 409 if the type exists
  → scaffoldDocumentType(appConfig.appId, docType, title)  // pure → { form, view }
  → validateDesignDefinition(form), validateDesignDefinition(view)  // 422 if invalid
  → applyDefinition(form); applyDefinition(view)  // upsert, local-first
  → 201 { form, view }
```

It reuses the existing upsert helper (which template apply already uses), so no new write machinery.
The scaffolded definitions replicate and promote via the template artifact unchanged — `currentDefinitions`
already packages every `form:*`/`view:*`.

## Why a view, not just a form

The runtime is driven by the **view picker → docType → form**: selecting a view determines the docType,
which resolves the form, and the form's "New" button creates a document of that docType. A new type with
no view is unreachable in the UI. So the scaffold creates both, and the new type appears in the picker on
the next refresh.

## Generic document constructor

`POST /api/documents` previously branched on `expense`/`vendor` hardcoded constructors; a new type would
have been mis-stamped `expense`. M12 routes it through `createDocument(docType, …)` so any scaffolded
type is stamped `doc:<docType>:<ulid>` with the right `docType`. The ACL readers still come from
`readersForNewDocument`.

## The studio UI

A "New document type" form (`new-type-form`) sits in the authoring studio: a docType slug input, an
optional title, and a Create button. On submit it `POST`s, and on success points the studio
(`selectedDefinitionId = form:<docType>`) and the view picker (`selectedViewId = view:<docType>`) at the
new type so it is immediately in front of the user; the subsequent refresh reloads definitions and the
new view tab appears. Errors (409/422) surface in the status message.

## Limits

- No workflow scaffold — new types are state-less (the runtime's back-compat path).
- The starter form is intentionally minimal (one `title` field); the citizen then shapes it with the
  M11 layout studio.
- Single-app: `appId` comes from `app:config`.
