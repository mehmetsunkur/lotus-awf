# 02 — Package Runtime

## Artifact

The deployable artifact is a Docker image built from the repo:

```bash
docker compose -p lotus-m13-deploy-test -f deploy/compose.yml up -d --build
```

The image:

- runs `npm ci` from `package-lock.json`;
- builds the TypeScript/Vite app with `npm run build`;
- starts with `npm start`;
- serves the built `dist/` client from Express when `dist/index.html` exists;
- exposes the API and web client on the same container port.

## Compose topology

`deploy/compose.yml` defines:

- `server-couchdb` on host port `15984`;
- `local-couchdb` on host port `15985`;
- `app` on host port `3101`;
- named volumes for both CouchDB replicas;
- no bind mount from the source checkout.

The existing root `docker-compose.yml` remains the development topology.

## Readiness

- `GET /api/health` is cheap liveness and does not touch CouchDB.
- `GET /api/ready` checks local CouchDB, server CouchDB, and both app databases.

The deploy gate waits for liveness, installs the packaged app with `/api/reset`, then waits for
readiness.
