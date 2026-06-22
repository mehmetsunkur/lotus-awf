# 04 - Acceptance

M17 is accepted when:

- The Expense design lives in `templates/expense/template.json`.
- Expense demo records live in `templates/expense/sample-data.json`.
- `src/server/seed-data.ts` no longer maintains duplicate hardcoded Expense definitions.
- `POST /api/platform/install-sample/expense` installs from the JSON-backed registry.
- Loaded templates are validated before CouchDB writes.
- Business documents are rejected from design templates.
- Runtime docs such as `agentrun:*`, `agent:state`, `auditevent:*`, and `audit:state` are not
  accepted as template definitions.
- `npm run build` passes.
- `npm run test:unit` passes.
- `npm run test:deploy` passes in an environment with Docker API access.

## Verification

```bash
npm run build
npm run test:unit
npm run test:deploy
```
