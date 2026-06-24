# ADR-0011: MCP over HTTP with per-session identity

Date: 2026-06-24

## Status

Accepted

## Context

The Lotus MCP adapter (ADR-0001, M24) shipped as three **stdio** servers (`admin`, `designer`,
`workspace`). Each runs as one process per user, takes a single identity from
`LOTUS_USERNAME`/`LOTUS_PASSWORD`, and caches one session cookie on one `LotusClient`. That model
is correct for a local coding agent but cannot be exposed over HTTP: one process would serve many
callers under one baked-in identity, which would bypass the directory/ACL boundary (ADR-0010).

We want to expose the same surfaces over HTTP so remote agents and hosted clients can use them,
without weakening the "MCP is a client adapter, not a backend authority" and "never accept a
caller-supplied principal" invariants.

## Taxonomy

- Subsystem: MCP, Server
- Domain Area: Access control, Agent interface, Deploy artifact
- Risk Class: Security, Contract / back-compat
- Runtime Surface: Internal API, Deploy Artifact

## Decision

Add an HTTP host (`src/mcp/http-server.ts`) that serves all three surfaces at `/mcp/<surface>` over
the MCP `StreamableHTTPServerTransport` (stateful, `randomUUID` session ids).

- **Identity per session.** On `initialize`, the caller presents an `Authorization` header — HTTP
  Basic (`username:password`, host logs in via `POST /api/session/login`) or Bearer (an existing
  `lotus_session` token, replayed). The host builds a dedicated `LotusClient` for that session and
  proves the identity against `GET /api/session`. The principal is always resolved server-side; the
  caller supplies credentials, never a principal. One MCP session maps to exactly one client.
- **Session registry.** Sessions are held in-memory and torn down on transport close, on MCP DELETE,
  and by an idle-TTL sweeper (`MCP_SESSION_TTL_MS`). Session ids are bound to their surface.
- **Transport security.** `Host`/`Origin` allowlisting (`MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS`)
  guards DNS rebinding; unauthenticated `initialize` returns 401.
- **No new authority.** The host reuses the existing `tools/*` registrations unchanged and only
  calls the Express API; it never touches CouchDB. Stdio entrypoints are unchanged.
- **Deployment.** The host runs as a sidecar container in the `lotus-app` pod (same image,
  `npm run mcp:http`), behind a `lotus-mcp` Service. The public ingress routes `designer`/`workspace`
  only; `admin` stays in-cluster.

## Alternatives Considered

1. Fold the host into the main Express app on one port (rejected: couples MCP authority into the app
   process and the layering boundary; sidecar keeps it a thin adapter).
2. Stateless transport (rejected: per-session identity needs state).
3. Bearer-only or mTLS/API-key inbound auth (deferred: Basic mirrors the existing stdio credential
   model and is the smallest new surface; Bearer is supported as a secondary scheme).
4. One shared service identity over HTTP (rejected: bypasses the directory/ACL boundary).

## Consequences

- Positive: remote/hosted MCP clients can use the surfaces with real per-user identity and ACL.
- Positive: no change to stdio usage, tool contracts, or the API authority model.
- Negative: in-memory session state means a host restart drops live MCP sessions (clients
  re-initialize); sessions are not shared across replicas (host stays single-replica with the app).
- Negative: an expired Bearer token cannot be auto-renewed mid-session (the caller re-initializes).

## Follow-Ups

- Optional OAuth/bearer provider via the SDK `auth` module for hosted multi-tenant use.
- Shared/session store if the host ever needs to scale beyond one replica.
