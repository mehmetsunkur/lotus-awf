# 03 - Build Plan

1. Add the M17 docs and acceptance criteria.
2. Extract the current Expense design docs into `templates/expense/template.json`.
3. Extract current demo business docs into `templates/expense/sample-data.json`.
4. Add a server-side loader that validates JSON artifacts and strips CouchDB revisions.
5. Refactor `seedDocuments()` to load the JSON artifacts for script/e2e compatibility.
6. Update `/api/platform/install-sample/expense` to install `sample:expense` through the loader.
7. Add tests for artifact boundaries and install compatibility.
8. Run build, unit tests, and deploy artifact verification.
