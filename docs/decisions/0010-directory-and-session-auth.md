# ADR-0010: Directory and session authentication

Date: 2026-06-22

## Status

Accepted

## Context

The platform currently runs as a fixed configured actor (`APP_USER`) and maps that actor to roles
through each app's `acl:rules`. That was enough for the ACL/replication spike, but it is not a real
platform security model. A Notes-like platform needs a directory first: people, groups, sessions, and
app ACLs that resolve against those principals.

## Taxonomy

- Subsystem: Shared, Server, Client
- Domain Area: Access control, App lifecycle, Offline-first
- Risk Class: Security, Contract / back-compat, Availability
- Runtime Surface: Web UI, Internal API, Deploy Artifact

## Decision

Use `setup_app` as the platform directory for `person:*` and `group:*` documents. Use `platform_app`
for `session:*` runtime documents. Authenticate users with username/password against Person documents,
hash passwords with salted Node `crypto.scrypt`, and issue opaque HTTP-only cookie sessions. Resolve
each session to person and direct group principals, then use app ACL levels plus document
`readers`/`authors` for authorization.

## Alternatives Considered

1. Keep `APP_USER` and add only UI login fields (rejected: not real auth).
2. Add OIDC first (deferred: too large for the first directory milestone).
3. Store sessions in memory (rejected: deploy/test restarts should not erase the contract).
4. Store people/groups in `setup_app` and sessions in `platform_app` (chosen).

## Consequences

- Positive: the runtime now has a real identity boundary and a Notes-like directory model.
- Positive: existing local-first document ACLs can resolve against directory principals.
- Negative: offline login is not solved; M18 requires the API to be reachable for login.
- Negative: direct CouchDB admin access remains a development-only escape hatch until a proper sync
  gateway/auth boundary exists.

## Follow-Ups

- Add nested group resolution with cycle detection.
- Add password rotation/reset flows.
- Add real production cookie/security configuration.
- Replace direct local CouchDB admin exposure with an authenticated sync boundary.
