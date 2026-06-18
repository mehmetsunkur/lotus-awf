# 03 — Deploy Test

The deploy gate is:

```bash
npm run test:deploy
```

It is an HTTP/Compose integration test, not a Playwright UI test. It proves the packaged platform can
be driven from outside the source process.

## Flow

1. Tear down any prior `lotus-m13-deploy-test` stack.
2. Build and start `deploy/compose.yml`.
3. Wait for `/api/health`.
4. Install the packaged expense app via `POST /api/reset`.
5. Wait for `/api/ready`.
6. Verify the built client is served from the app container.
7. Verify expense definitions are installed.
8. Create, update, submit, and approve an expense.
9. Search for the expense through a metadata view.
10. Create a new `inspection` document type through the design API.
11. Create and list an inspection document.
12. Run agents and audit.
13. Export the current app template.
14. Run replication.
15. Tear down containers and volumes.

## Requirements

The command requires access to the local Docker API. If the current user cannot access
`/var/run/docker.sock`, the test cannot run in that environment.
