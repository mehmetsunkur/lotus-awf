# 04 — Acceptance

M13 is accepted when:

- `npm run build` passes.
- `npm run test:unit` passes.
- `npm run test:deploy` passes in an environment with Docker API access.
- The deploy compose stack starts from the built image with no source bind mount.
- `GET /api/ready` reports both CouchDB replicas and first-run platform app readiness without manual setup.
- The deploy gate creates and mutates business documents through HTTP.
- The deploy gate applies at least one design mutation and proves the new type is usable.
- The deploy gate verifies agents, audit, template export, and replication.
- Existing source-mode e2e tests remain compatible.

## Demo

```bash
npm run test:deploy
```

The command is the demo: it installs the platform artifact, exercises the first-run app flow, runs app
and design operations, and removes the stack.
