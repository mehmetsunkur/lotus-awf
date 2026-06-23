# 03 - Runtime Flow

## Authentication

The MCP client logs in once with `POST /api/session/login`, captures the `Set-Cookie` header, and
replays that cookie on subsequent requests. If Lotus returns `401`, the client clears the cookie and
retries login once.

This mirrors the M18 browser session contract. Service credentials are deferred.

## API boundary

The MCP process is a client of the existing Express API:

- Platform discovery uses `/api/platform/state`.
- Definitions use `/api/apps/:appId/definitions`.
- Workflow scaffold uses `/api/apps/:appId/workflows/scaffold`.
- Document type creation uses `/api/apps/:appId/document-types`.
- Templates use `/api/apps/:appId/templates/export|diff|apply`.
- Direct definition updates use `/api/apps/:appId/definitions/:id`.

The MCP process does not import server internals or CouchDB helpers.

## Validation

Individual definition validation uses `src/shared/definition-validation.ts`. Template validation uses
a shared pure validator so MCP and the server use the same artifact rules. Validation in MCP is an
early failure path only; the Express API remains the write authority.

## Workflow patches

Workflow patch tools:

1. Fetch `GET /api/apps/:appId/definitions`.
2. Select `workflow:<docType>`.
3. Apply operations to a normalized copy.
4. Validate with `validateWorkflowDefinition`.
5. Return a preview or write through `PUT /api/apps/:appId/definitions/:id`.

The first implementation performs a full definition update through the existing API. Strict
compare-and-swap by `_rev` is a future hardening step because the current API owns latest-revision
lookup server-side.

## Verification

M24 is primarily verified by unit tests and TypeScript build. End-to-end coverage may be added later
around a running MCP client plus CouchDB-backed Lotus server.
