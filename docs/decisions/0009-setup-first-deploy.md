# ADR-0009: Setup-first deploy

Date: 2026-06-18

## Status

Accepted

## Context

M13 made Lotus deployable but initially booted directly into the Expense sample. That made the artifact
look like a demo app rather than an app operating system. A fresh platform deployment should first
capture organization/admin setup, then show an app catalog.

## Taxonomy

- Subsystem: Server, Client, deployment
- Domain Area: App lifecycle, Deployment & packaging
- Risk Class: Availability, Security posture
- Runtime Surface: Web UI, Internal API, Deploy Artifact

## Decision

Fresh deploy installs `setup_app` (`setup.nsf`) and `platform_app`, not `expense_app`. The setup flow
stores organization/domain/admin setup state in `platform_app`. After setup, the UI shows an empty app
catalog. The Expense app is an optional sample installed explicitly from the catalog.

## Alternatives Considered

1. Keep auto-installing Expense (rejected: product reads as an app demo, not a platform).
2. Build a full app-template registry first (deferred in M14; M17 adds a filesystem-backed sample
   registry, while remote registry/version rollback remain future work).
3. Add setup-first boot plus minimal catalog (chosen).

## Consequences

- Positive: the deployed artifact now behaves like a platform; AI/app-template work has a clearer
  home in the catalog/control plane.
- Negative: auth remains a development-only placeholder, and the catalog is intentionally minimal.

## Follow-Ups

- M17 replaced the hardcoded sample installer with a JSON-backed `sample:expense` registry entry.
- Add real identity/session management.
- Add governed change sets for AI config agents.
