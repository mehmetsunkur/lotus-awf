# 06 — Implementation Notes

## Implemented runtime behavior

M4 adds a structured authoring studio over the existing replicated definition documents:

- `form:*` definitions can be edited with field controls, including add/remove, name, label, type,
  and required flag;
- `view:*` definitions can be edited with column controls plus simple sort/filter controls;
- `workflow:*` definitions can be edited with state and transition controls;
- the raw JSON editor remains available as an escape hatch;
- every save still writes the local CouchDB replica through `PUT /api/definitions/:id`.

Structured edits update the JSON document in memory. This keeps one persisted source of truth and
avoids introducing an M4-only definition shape.

## Definition validation

`src/shared/definition-validation.ts` validates forms, views, and workflows before local definition
writes. The client calls it before save for immediate feedback, and the API calls it before writing to
CouchDB. Invalid definitions return `422 definition_validation_failed`.

The validator checks required fields, duplicate names/ids, section references, view columns/sorts,
workflow state/transition references, and expression syntax/safety through the existing expression
runtime.

## Known limitations and risks

- The studio is not drag-and-drop and does not attempt a visual workflow graph.
- Expression editing is still trusted-developer posture; M4 catches malformed or blocked expressions
  but does not harden the evaluator for arbitrary citizen-authored code.
- Definition conflicts still resolve by choosing a revision; there is no field-level merge.
- View authoring can still create query shapes that need future index work if raw JSON is used beyond
  the structured controls.

## Verification performed

```bash
npm run build
npx playwright test tests/e2e/authoring-studio.spec.ts
npm run test:e2e
```

Final result: the full e2e suite passed (`20 passed`).
