# M24 - MCP Agent Interface

M24 exposes Lotus as a Model Context Protocol server for coding agents. The MCP surface lets an
agent inspect installed apps, read and validate definitions, scaffold approval workflows, and apply
reviewable definition changes through the existing Express API.

The milestone deliberately does not give agents direct CouchDB access. The Express runtime remains
the authority for sessions, app ACL, validation, local-first writes, template diff/apply, and
workflow scaffold behavior.

## Goal

- Run a stdio MCP server as a local child process for coding agents.
- Authenticate to Lotus with the existing username/password session-cookie flow.
- Expose read-only app/design inspection tools.
- Expose safe design mutation tools for document-type creation, approval workflow scaffolding, and
  validated workflow updates.
- Prefer diff-first template changes over blind raw definition writes.
- Keep all writes behind app-scoped API routes and shared validators.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary, risk classes, and non-goals |
| [02-tool-contract.md](02-tool-contract.md) | MCP configuration and tool contract |
| [03-runtime-flow.md](03-runtime-flow.md) | Auth, API client, validation, and mutation safety flow |
| [04-build-plan.md](04-build-plan.md) | Implementation sequence |
| [05-acceptance.md](05-acceptance.md) | Exit criteria and verification |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

M24 is an agent-facing design interface, not a new backend authority.

The working question is:

> Can coding agents create and update Lotus workflows through a constrained MCP surface while
> preserving the definitions-as-data, session, ACL, validation, and template-promotion contracts?
