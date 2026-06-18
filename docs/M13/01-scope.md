# 01 — Scope

## In scope

- Production-oriented Docker image using the repository lockfile.
- Express static serving for the built Vite client.
- A deploy compose topology under `deploy/` with CouchDB local/server replicas and no source bind
  mount.
- Readiness that verifies CouchDB reachability and app database existence.
- A deploy integration gate that drives the package externally over HTTP.
- Documentation for the deploy flow and verification command.

## Out of scope

- LLM integration or AI config agents.
- Change-set approval workflow.
- Enterprise auth, multi-tenant SaaS, or production secrets management.
- Sandboxed expression replacement.
- Plugin package deployment.
- Distributed agent scheduling or HA CouchDB.

## Decision

M13 treats `/api/reset` as the packaged expense-app install path for the deploy gate. A future control
plane can replace that with app-template installation and governed change sets, but this milestone only
needs a deterministic, externally verifiable platform install.
