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
4. Wait for `/api/ready`, which requires the first-run platform app/control databases to exist.
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

The command requires access to the local Docker API. It uses plain `docker` when available, otherwise
falls back to `sudo -n docker`. Set `DOCKER_USE_SUDO=1 npm run test:deploy` to force sudo. If sudo
requires an interactive password, the test cannot run unattended.

The gate first probes the published host port (`http://localhost:3101`). If that is unavailable in the
current Docker environment, it falls back to the app container IP while keeping the same packaged
compose topology.
