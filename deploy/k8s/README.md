# Lotus Notes Kubernetes Deployment

These manifests are the first Kubernetes shape for the packaged Lotus runtime. They mirror the
current deploy artifact topology: one app pod, one local CouchDB pod, and one server CouchDB pod.

## Files

- `namespace.yaml` creates the `lotus-notes` namespace.
- `secret.example.yaml` is a template for CouchDB credentials. Copy it before applying real secrets.
- `configmap.yaml` contains non-secret runtime settings.
- `local-couchdb.yaml` and `server-couchdb.yaml` run internal CouchDB `StatefulSet`s with PVCs.
- `app.yaml` runs the Lotus app image (with the MCP-over-HTTP host as a sidecar container)
  and a `lotus-mcp` Service, and wires liveness/readiness probes for both.
- `ingress.yaml` exposes the app through an nginx ingress placeholder, and routes the MCP
  `designer`/`workspace`/`admin` surfaces. `ingress.traefik.yaml` is the Traefik variant for
  k3s-style clusters. As of ADR-0011's 2026-06-24 amendment the `admin` surface IS routed
  publicly; it is protected by the app's Basic/Bearer auth and the MCP `Host`/`Origin`
  allowlist, not by network isolation. To keep admin in-cluster, drop its ingress path
  and/or restrict it with a NetworkPolicy.

## Required Client Decisions

- Replace `lotus.example.com` in `configmap.yaml` and `ingress.yaml`.
- Replace `lotus-tls` in `ingress.yaml` or configure cert-manager for the client cluster.
- Replace the example CouchDB password before applying secrets.
- Confirm PVC storage class and size. The default request is `10Gi` per CouchDB role.
- Confirm backup and restore policy before users enter real data.

## Build The Image

CI (`.github/workflows/image.yml`) builds and gates the image on amd64 and arm64 for every push to
`main` and publishes the multi-arch `cr.lan.sunkur.net/lotus-notes/platform:<sha7>` (and `:latest`).
Point `deploy/k8s/app.yaml` at an immutable tag before applying:

```bash
make k8s-set-image IMAGE_TAG=<sha7>
```

For a one-off single-arch image from a workstation, `make image-push` pushes `:<sha7>` only (never
`:latest`); use `REGISTRY=registry.example.com` for another registry.

## Configure Secrets

```bash
cp deploy/k8s/secret.example.yaml deploy/k8s/secret.yaml
# edit deploy/k8s/secret.yaml with client credentials
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/secret.yaml
```

Do not commit `deploy/k8s/secret.yaml`.

## Deploy

```bash
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/local-couchdb.yaml
kubectl apply -f deploy/k8s/server-couchdb.yaml
kubectl apply -f deploy/k8s/app.yaml
kubectl apply -f deploy/k8s/ingress.yaml
```

Or, after creating `deploy/k8s/secret.yaml`:

```bash
make k8s-apply
```

Validate the manifest set locally without a cluster:

```bash
make k8s-dry-run
```

## Smoke Checks

```bash
kubectl -n lotus-notes rollout status statefulset/local-couchdb
kubectl -n lotus-notes rollout status statefulset/server-couchdb
kubectl -n lotus-notes rollout status deployment/lotus-app
kubectl -n lotus-notes port-forward svc/lotus-app 3001:80
curl -fsS http://localhost:3001/api/health
curl -fsS http://localhost:3001/api/ready
```

Open `/setup.nsf` through the ingress hostname, complete organization/admin setup, then create a
business app or install the Expense sample from the catalog.

## Operational Notes

- Keep `replicas: 1` for `lotus-app` until background agents/audit have distributed coordination.
- `AGENTS_INTERVAL_MS` is intentionally unset. Agents and audit run by explicit API calls unless the
  client decides to enable a single always-on scheduler pod.
- CouchDB services are `ClusterIP` only. Do not expose CouchDB through ingress.
- `COOKIE_SECURE=1`, `TRUST_PROXY=1`, and `CORS_ORIGIN` are set for ingress-backed HTTPS.
- The MCP host runs as a sidecar and authenticates each MCP session against the app API
  (HTTP Basic username/password, or Bearer Lotus session token). It never accepts a
  caller-supplied principal. Keep the `admin` surface off the public ingress; restrict it
  with network policy. `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS` gate DNS-rebinding.
- Backup/restore is outside these manifests. Use the client platform's PVC snapshots or a CouchDB
  backup job and test restore before production data entry.
