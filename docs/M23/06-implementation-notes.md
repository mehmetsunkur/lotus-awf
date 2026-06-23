# 06 - Implementation Notes

## Implemented

- Added `src/shared/workflow-scaffold.ts` with a pure approval scaffold helper and approver-principal
  validation.
- Added `GET /api/apps/:appId/workflows/scaffold-options` for designer-level sanitized approver
  choices.
- Added `POST /api/apps/:appId/workflows/scaffold` to write generated workflow and views local-first.
- Added a Designer scaffold panel for forms that do not yet have a workflow.
- Added unit, e2e-source, and deploy-source coverage for generated workflow definitions.

## Verification

- `npm run build` passed.
- `npm run test:unit` passed.
- `npm run test:e2e -- tests/e2e/catalog-apps.spec.ts` could not complete because CouchDB at
  `http://localhost:5985/` was not reachable within 60 seconds.
- `npm run test:deploy` passed, including scaffolded workflow submit/approve coverage in the
  deployable artifact.
