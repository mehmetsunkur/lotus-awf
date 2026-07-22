# Context Map

Start with `docs/taxonomy.md` to classify the task and choose which context notes, ADRs, and tests
apply.

| Area | Card | Purpose | Tests |
| --- | --- | --- | --- |
| Shared | `docs/context/shared.md` | Portable contracts, validators, expressions, workflow/search/layout/scaffold logic | `npm run test:unit`; `npm run test:e2e` indirect |
| Server | `docs/context/server.md` | Express API, CouchDB replicas, sessions, app-scoped runtime/design routes | `npm run test:e2e`; `npm run test:deploy` |
| Client | `docs/context/client.md` | React metadata runtime and designer workspaces | `npm run test:e2e` |
| MCP Adapter | `docs/context/mcp.md` | Stdio MCP tools for agent-driven app/design operations over Express APIs | `npm run build`; `npm run test:unit` |
| Playground | `docs/context/playground.md` | Local company testbed runner for Lotus, MCP, sidecars, and persona agents | `npx tsc --noEmit`; `npm run playground -- field-services --once` |

Add subsystem cards as the project grows.
