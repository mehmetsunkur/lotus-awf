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
- no bind mount from the source checkout;
- `APP_AUTO_SETUP=1`, which installs the first-run packaged app/control databases.

The existing root `docker-compose.yml` remains the development topology.

## Kubernetes topology

`deploy/k8s/` defines the first Kubernetes deployment shape for client clusters:

- `lotus-app` as a single-replica `Deployment`;
- `local-couchdb` and `server-couchdb` as separate one-replica `StatefulSet`s;
- internal `ClusterIP` services for both CouchDB roles;
- `PersistentVolumeClaim`s for both CouchDB data directories;
- `lotus-config` for non-secret runtime settings;
- `lotus-secrets` for CouchDB credentials;
- an optional ingress placeholder for HTTPS access to the app only.

The Kubernetes topology keeps the same runtime contract as Compose: the app talks to a local CouchDB
role and a server CouchDB role, `APP_AUTO_SETUP=1` installs `setup_app` and `platform_app`, and
readiness is exposed through `GET /api/ready`.

Production ingress deployments should set:

- `TRUST_PROXY=1` so Express respects the ingress proxy;
- `COOKIE_SECURE=1` so session cookies are marked Secure;
- `CORS_ORIGIN=https://<client-hostname>` to restrict browser origins.

## Readiness

- `GET /api/health` is cheap liveness and does not touch CouchDB.
- `GET /api/ready` checks local CouchDB, server CouchDB, and the first-run app/control databases.

The deploy gate waits for liveness and then readiness. It does not call `/api/reset`; a fresh deploy
must install the first-run platform app during startup.
