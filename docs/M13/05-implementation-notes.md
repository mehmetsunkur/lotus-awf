# 05 — Implementation Notes

## Implemented behavior

M13 adds a deployable runtime path:

- `Dockerfile` now installs dependencies, builds the Vite client, and starts the Express server with
  `npm start`.
- Express serves `dist/` and falls back to `index.html` for non-API routes when a built client exists.
- `GET /api/ready` checks both CouchDB replicas and app database existence.
- `deploy/compose.yml` runs the built app image plus local/server CouchDB replicas on isolated host
  ports and enables `APP_AUTO_SETUP=1`.
- `APP_AUTO_SETUP=1` waits for both CouchDB replicas and installs the first-run packaged app/control
  databases so a fresh deploy does not land on an empty setup screen.
- `deploy/k8s/` adds Kubernetes manifests for a one-replica app deployment, two internal CouchDB
  StatefulSets, PVC-backed CouchDB data, ConfigMap/Secret runtime configuration, and an optional app
  ingress.
- Production ingress knobs are available through `TRUST_PROXY=1`, `COOKIE_SECURE=1`, and
  `CORS_ORIGIN=https://<client-hostname>`.
- `npm run test:deploy` runs `tests/deploy/deploy-artifact.ts`, an external HTTP integration gate over
  the deploy compose stack.

## Verification performed

```bash
npm run build
docker compose -f deploy/compose.yml config
npm run test:unit
npm run test:deploy
make k8s-dry-run
```

`npm run test:deploy` uses Docker directly when available and falls back to `sudo -n docker` for
environments where Docker access is granted through passwordless sudo. It also falls back from the
published host port to the app container IP if host port publishing is unavailable in the Docker
environment.

## Known limitations and risks

- Boot-time first-run setup is the M13 install mechanism; M14 changes the installed app to
  `setup.nsf`, and M17 replaces the hardcoded sample installer with a JSON-backed template registry.
- The image includes dev/build dependencies in `node_modules`; a smaller multi-stage image is deferred.
- Kubernetes manifests default to one app replica. Background agent/audit ticks should stay explicit
  unless a single scheduler or distributed coordination is added.
- Production identity integration, password policy, expression sandboxing, governed AI change sets,
  and automated backup/restore remain future work.
- The deploy gate depends on local Docker API access or passwordless sudo for Docker.
