# 03 - Runtime Flow

## Authentication

Each MCP server logs in once with `POST /api/session/login`, captures the `Set-Cookie` header, and
replays that cookie on subsequent requests. If Lotus returns `401`, the client clears the cookie and
retries login once.

This mirrors the M18 browser session contract. Service credentials are deferred.

## API boundary

The MCP processes are clients of the existing Express API:

- Admin uses `/api/platform/state`, `/api/platform/apps`, and `/api/apps/:appId/access`.
- Designer uses `/api/apps/:appId/definitions`, `/api/apps/:appId/document-types`,
  `/api/apps/:appId/workflows/scaffold`, `/api/apps/:appId/templates/export|diff|apply`, and
  `/api/apps/:appId/definitions/:id`.
- Workspace uses `/api/apps/:appId/documents`, `/api/apps/:appId/views/:id/documents`,
  `/api/apps/:appId/documents/:id`, and `/api/apps/:appId/documents/:id/transition`.

MCP code does not import server internals or CouchDB helpers. It imports only pure shared validators
and workflow patch helpers.

## Validation

Individual definition validation uses `src/shared/definition-validation.ts`. Template validation uses
`src/shared/template-validation.ts`. Validation in MCP is an early failure path only; the Express API
remains the write authority.

Workspace payload validation is performed by the existing document create/update APIs.

## Workflow patches

Designer workflow patch tools:

1. Fetch `GET /api/apps/:appId/definitions`.
2. Select `workflow:<docType>`.
3. Apply operations to a normalized copy.
4. Validate with `validateWorkflowDefinition`.
5. Return a preview or write through `PUT /api/apps/:appId/definitions/:id`.

The implementation performs a full definition update through the existing API. Strict
compare-and-swap by `_rev` is a future hardening step because the current API owns latest-revision
lookup server-side.

## Verification

`npm run test:mcp` launches each stdio server through the official MCP client transport and exercises
one representative flow per surface against the real Express API and CouchDB pair.
