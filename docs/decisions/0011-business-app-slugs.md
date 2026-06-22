# ADR-0011: Business app slugs map to app databases

Date: 2026-06-22

## Status

Accepted

## Context

M20 made `setup.nsf`, `catalog.nsf`, and `expense.nsf` share the same workspace shape, but business
app routing and APIs still assumed the configured Expense database. The vision requires the catalog
to create real apps, each with forms, views, documents, ACL, promotion, and offline replication.

## Taxonomy

- Subsystem: Server + Client + Shared
- Domain Area: App lifecycle, Offline-first, Definitions-as-data
- Risk Class: Contract / back-compat, ACL, Data integrity
- Runtime Surface: Web UI, Internal API, Deploy Artifact

## Decision

Use the business app id as the canonical slug and route. An installed app with `appId: "field-reports"`
opens at `/field-reports.nsf` and stores data in `field-reports_app`. Install records in
`platform_app` are the route source of truth. Runtime APIs gain app-scoped variants under
`/api/apps/:appId/...`, and unscoped routes remain compatibility aliases for the packaged Expense
sample.

System apps remain reserved and special: `setup.nsf`, `catalog.nsf`, and `login.nsf` do not map to
business app databases.

## Alternatives Considered

1. Keep one configured business app database (rejected): preserves the sample-app shape but does not
   create platform-owned apps.
2. Use independent route slugs separate from app ids (rejected): adds an alias/rename problem before
   app rename exists.
3. App id as route slug and database prefix (chosen): simple, deterministic, and matches existing
   `AppConfig` / `AppInstall` fields.

## Consequences

- Positive: arbitrary installed apps can use the generic NSF shell and metadata runtime.
- Positive: existing Expense routes stay compatible through aliases.
- Negative: app rename is deferred because route, id, and database are intentionally coupled.
- Negative: server helpers must be parameterized by database instead of relying on `config.appDb`.

## Follow-Ups

- App deletion/rename and database lifecycle management.
- User-visible template registry for blank and custom app templates.
- Full app ACL editor.
