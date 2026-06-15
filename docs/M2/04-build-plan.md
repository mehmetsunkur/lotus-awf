# 04 — Build Plan

## Step 1 — M2 docs and contracts

Add M2 scope, data contract, expression runtime, build plan, and acceptance docs.

Exit when the milestone boundary is explicit.

## Step 2 — Shared expression and validation modules

Add shared runtime code for:

- expression evaluation;
- field visibility/read-only/required behavior;
- validation errors;
- payload defaults.

Exit when client and API can call the same validation functions.

## Step 3 — Seed richer app definitions

Extend seed data with:

- richer `form:expense`;
- `form:vendor`;
- `view:all-expenses`;
- `view:vendors`;
- sample vendor documents;
- Mango indexes.

Exit when reset creates an M2 app database.

## Step 4 — API query and definition support

Replace broad document scans for runtime lists with `_find`.

Add APIs for:

- all forms/views;
- saving definition docs locally;
- resolving conflicts on any document type.

Exit when the runtime can edit definitions locally.

## Step 5 — Runtime UI

Add:

- view picker;
- doc type aware form editor;
- support for richer field types;
- vendor select sourced from local docs;
- JSON definition editor;
- reusable conflict inspector.

Exit when offline local definition edits immediately affect forms/views.

## Step 6 — Acceptance verification

Run build and live CouchDB checks:

- reset;
- replicate;
- create/edit expense and vendor;
- edit definition locally;
- sync;
- force data conflict;
- force definition conflict;
- resolve conflict.

Exit with updated notes and clean git status.

