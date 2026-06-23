# 05 - Acceptance

- A coding agent can launch the MCP server over stdio.
- The MCP server can authenticate to a running Lotus API with username/password and session cookie.
- Read tools can list installed apps and fetch app definitions.
- Read tools can fetch workflow scaffold options without exposing password or session fields.
- A tool can create a document type through the app-scoped API.
- A tool can scaffold the standard approval workflow through the app-scoped API.
- Validation tools reject invalid workflow definitions before a write attempt.
- Workflow patch preview returns a validated changed workflow without writing.
- Workflow patch apply writes through `PUT /api/apps/:appId/definitions/:id`.
- MCP tools do not write directly to CouchDB or mutate business documents.
- Build and unit tests pass; unavailable e2e/deploy status is recorded.
