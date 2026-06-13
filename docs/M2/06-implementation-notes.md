# 06 — Implementation Notes

## Implemented runtime behavior

M2 extends the M1 runtime with replicated, metadata-driven forms and views:

- multiple forms are loaded from local `form:*` documents;
- multiple views are loaded from local `view:*` documents;
- view selection drives the document list and matching form;
- `expense` and `vendor` documents coexist in `expense_app`;
- select fields can source options from local documents;
- a local JSON editor can save `form:*` and `view:*` definition documents;
- business and definition conflicts use the same conflict inspector/resolver.

The runtime remains local-first. Normal document and definition reads/writes go to local CouchDB.
Server CouchDB is used for replication and server-side demo mutations.

## Expression and validation posture

M2 uses the shared modules:

- `src/shared/expression.ts`
- `src/shared/validation.ts`

The evaluator accepts simple JavaScript expressions over:

```ts
{ payload, doc, user, now }
```

It blocks obvious unsafe tokens but is not a hardened untrusted-code sandbox. M2 treats expressions
as trusted developer-authored definitions. Before citizen users can write expressions, replace or
isolate the evaluator with a hardened runtime such as CEL or QuickJS.

Validation runs in the browser before submit and in the API before local CouchDB writes.

## Form and view contract changes

M2 adds these field capabilities:

- `textarea`
- `boolean`
- `select`
- `defaultValue`
- `helpText`
- `options`
- `source`
- `visibleWhen`
- `readOnlyWhen`
- `requiredWhen`
- `validate`
- `sections`

M2 adds view `filters` and keeps existing `columns` and `sort`.

## Query and index strategy

Reset/seed creates Mango indexes:

- `m2-kind-docType-updatedAt`
- `m2-readers`

Runtime view lists use `_find` instead of broad `_all_docs` scans. Conflict scans still use
`_all_docs?include_docs=true&conflicts=true`, which is acceptable for the M2 demo but not a scalable
production conflict queue.

## Definition editing

The runtime includes a textarea-based JSON definition editor for `form:*` and `view:*` documents.

Local edits take effect after save and refresh. If the server is offline, the local definition edit
still changes the runtime locally and can sync later.

## Conflict handling

M2 conflict handling is generic across data and definition documents:

- `GET /api/conflicts`
- `GET /api/conflicts/:id`
- `POST /api/conflicts/:id/resolve`

Resolution keeps the current winning revision and deletes losing conflict leaf revisions. This
clears the conflict locally; a subsequent replication sends the resolved winner onward.

Use these demo routes:

```text
POST /api/demo/conflict
POST /api/demo/definition-conflict
```

The first creates a business document conflict. The second creates a `form:expense` conflict.

## Verification performed

The implementation was verified with:

```bash
npm run build
docker compose up -d --build
npm run reset
npm run replicate
npm run force-conflict
curl -sf -X POST http://localhost:3001/api/demo/definition-conflict
```

Live API checks also verified:

- `GET /api/definitions` returns `form:expense`, `form:vendor`, and three views;
- `GET /api/views/view%3Amy-expenses/documents` returns expense docs;
- `GET /api/views/view%3Avendors/documents` returns vendor docs;
- `GET /api/forms/expense/options` returns vendor select options;
- invalid expense amount returns `422 validation_failed`;
- valid expense creation persists a local document with a vendor reference;
- `PUT /api/definitions/form%3Avendor` saves a local definition edit;
- definition conflict resolution clears `form:expense` from the conflict queue.

## Known limitations and risks

- The expression evaluator is not safe for untrusted citizen-authored expressions.
- The JSON definition editor is intentionally primitive and can save structurally invalid definitions.
- Runtime lists are indexed, but the index strategy is still minimal.
- Conflict resolution keeps the winning revision; no field-level merge is implemented.
- Select relationships are references only; no referential integrity or cascade behavior exists.
- ACL revocation purge remains the conditional M1 finding and is not solved in M2.
- Docker still expects host `npm install` because container-side npm install hung in this environment.

