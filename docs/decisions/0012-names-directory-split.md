# ADR-0012: Split the directory into names.nsf

Date: 2026-07-01

## Status

Accepted — supersedes the storage-location choice in ADR-0010.

## Context

ADR-0010 stored the platform directory (`person:*`, `group:*`, including password hashes) in
`setup_app` and surfaced it through the `setup.nsf` system app, which also hosted the first-run
org/admin wizard. That conflated two Notes concepts: the Domino Directory (`names.nsf` — the public
directory of people and groups) and one-time server setup. `setup_app` in practice held nothing but
the directory plus its own `app:config`, so the conflation bought no simplicity and diverged from the
Notes model the platform is modeled on.

## Taxonomy

- Subsystem: Identity & sessions
- Domain Area: Directory, authentication, platform bootstrap
- Risk Class: Security, Contract / back-compat
- Runtime Surface: Web UI, Internal API, Deploy Artifact

## Decision

Introduce `names_app` (`NAMES_DB`, default `names_app`) as the directory database, surfaced as the
`names.nsf` system app — the standing directory-admin console for people and groups. Move all
`person:*`/`group:*` documents and their `app:config` there; the identity invariant now pins password
hashes to `names_app`. Re-home the directory HTTP API to `/api/names/*` (hard cut, no `/api/setup/*`
directory aliases). `setup.nsf` remains only as the first-run org/admin wizard: it has no dedicated
database (it writes the admin person into `names_app` and org config into `platform_app`) and drops
out of the system-app catalog once `setupComplete` is true.

## Alternatives Considered

1. Add `/names.nsf` as a second read face over `setup_app` (rejected: real `names.nsf` is the store,
   not a view; keeps the misleading `setup_app` name).
2. Move storage to `names_app` but keep the `/api/setup/*` directory route names (rejected: leaves the
   contract half-migrated and the naming inconsistent).
3. Keep `setup_app` as-is (rejected: diverges from the Notes model the platform emulates).

## Consequences

- Positive: the directory now matches the Notes `names.nsf` model; setup is a clean, transient wizard.
- Positive: `person:*`/`group:*` and password hashes live in a purpose-named database.
- Negative: a breaking change — `SETUP_DB`/`setup_app` and the `/api/setup/*` directory routes are
  removed; deploy config, the directory console, and the setup/directory e2e all move in lockstep.
- Negative: existing deployments must copy the `setup_app` directory into `names_app` (dev installs
  simply re-seed).

## Follow-Ups

- Deploy artifact auto-installs and readiness-checks `names_app`; `npm run test:deploy` exercises it.
- Document the one-time `setup_app` → `names_app` copy for live upgrades.
