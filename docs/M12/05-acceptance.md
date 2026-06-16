# 05 — Acceptance

## Demo scenario

1. Open the studio; in "New document type" enter a docType (e.g. `invoice`) and a title; click Create.
2. The new type's list view (`view:invoice`) appears in the runtime view picker.
3. Open that view (empty), click New, fill the scaffolded Title field, and save; the document lists.
4. Attempt to create a type that already exists (e.g. `expense`) → rejected (409).
5. Attempt an invalid slug (e.g. `Bad Slug!`) → rejected (422).
6. Export the app template; the scaffolded `form:invoice` and `view:invoice` are included.

## Exit criteria

M12 is complete when the project can prove:

- a citizen creates a new document type from the studio in one action, scaffolding a form + list view;
- the new type is immediately reachable in the runtime (its view in the picker, its form to create
  documents);
- a document of the new type is stamped with the correct `docType`/`_id` (generic constructor);
- a duplicate type is rejected (409) and an invalid slug is rejected (422);
- the scaffolded definitions are valid (shared validators) and promote via the template artifact;
- no new substrate or Mango index is introduced.
