# 05 — Implementation Notes

## Implemented behavior

M13 adds a deployable runtime path:

- `Dockerfile` now installs dependencies, builds the Vite client, and starts the Express server with
  `npm start`.
- Express serves `dist/` and falls back to `index.html` for non-API routes when a built client exists.
- `GET /api/ready` checks both CouchDB replicas and app database existence.
- `deploy/compose.yml` runs the built app image plus local/server CouchDB replicas on isolated host
  ports.
- `npm run test:deploy` runs `tests/deploy/deploy-artifact.ts`, an external HTTP integration gate over
  the deploy compose stack.

## Verification performed

```bash
npm run build
docker compose -f deploy/compose.yml config
npm run test:unit
npm run test:deploy
```

`npm run test:deploy` uses Docker directly when available and falls back to `sudo -n docker` for
environments where Docker access is granted through passwordless sudo. It also falls back from the
published host port to the app container IP if host port publishing is unavailable in the Docker
environment.

## Known limitations and risks

- `/api/reset` is the M13 app install path; future app-template installation should replace it.
- The image includes dev/build dependencies in `node_modules`; a smaller multi-stage image is deferred.
- Production auth, secrets, expression sandboxing, and governed AI change sets remain future work.
- The deploy gate depends on local Docker API access or passwordless sudo for Docker.
