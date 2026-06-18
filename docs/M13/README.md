# M13 — Deployable Platform Artifact

M13 stabilizes the platform as something that can be packaged, started, and exercised from the
outside. The goal is not AI authoring yet; it is a deployable Lotus runtime that future AI config
agents can target through stable HTTP/API surfaces.

M1–M12 proved the app substrate: replicated data, metadata-driven forms/views, workflow, security,
promotion, plugins, agents, search, audit, studio layout, and document-type scaffolding. M13 proves the
substrate can run from a built artifact rather than a source checkout.

## Goal

- Build a self-contained Docker image from `package-lock.json`.
- Serve the built React client from the Express runtime in production mode.
- Run the platform with a deploy compose topology that has no source bind mount.
- Install the packaged app into fresh CouchDB replicas (M14 changes the first-run packaged app to
  `setup.nsf`).
- Exercise CRUD, workflow, search, design mutation, agents, audit, template export, and replication
  through external HTTP calls.
- Keep dev/test source-mode workflows unchanged.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary and non-goals |
| [02-package-runtime.md](02-package-runtime.md) | Artifact, compose, and readiness contract |
| [03-deploy-test.md](03-deploy-test.md) | Deploy verification flow |
| [04-acceptance.md](04-acceptance.md) | Demo and exit criteria |
| [05-implementation-notes.md](05-implementation-notes.md) | Final notes and verification |

## Core posture

M13 is the platform install gate:

> Can Lotus Notes be deployed as an artifact, install an app, and prove the app lifecycle externally?
