# Testing Guide

## Doc Sync Metadata

- Last code review baseline: `TBD`
- Last reviewed date: `YYYY-MM-DD`
- Code areas:
  - `TBD`
- Tests:
  - `TBD`
- Review trigger:
  - Update this doc when test commands, test layers, fixtures, or verification routes change.

## Commands

```bash
npm run build        # TypeScript no-emit check + Vite production build
npm run test:unit    # Vitest shared/runtime unit tests
npm run test:mcp     # MCP stdio integration tests; needs CouchDB pair + Express API
npm run test:mcp:agent # Opt-in real-agent MCP acceptance; writes playwright-report-mcp-agent
npm run test:e2e     # Playwright source-mode runtime tests; starts CouchDB pair
npm run test:deploy  # M13 deploy artifact gate; requires Docker API access
npm run seed:airline # seed the M25 Agentic Airlines scenario into a running server for manual testing
                     # (env: API_URL, ADMIN_USER/ADMIN_PASSWORD, ORG_APP_ID/LEAVE_APP_ID, RESET=1)
npm run perf:me-filter -- --docs 10000 --runs 20
                     # local/dev benchmark for ADR-0020 @me view filters; starts an isolated
                     # CouchDB/API harness, seeds Agentic Airlines, bulk-loads synthetic docs,
                     # then times authenticated view routes and reports the bound Mango index
make deploy-seed     # deploy-stack one-shot: finds the app port, completes first-run setup if
                     # needed, then seeds the airline (idempotent; env: LOTUS_APP_PORT, ADMIN_USER,
                     # ADMIN_PASSWORD, ORG_NAME, DOMAIN_NAME)
make k8s-dry-run     # Kubernetes manifest render check; requires kubectl
```

## Rules

- Use existing test style first.
- Add regression tests for bug fixes.
- Add integration tests for cross-boundary behavior.
- Record any test that could not be run.

## Feature Area To Tests

| Area | Primary Tests |
| --- | --- |
| Shared pure engines | `npm run test:unit` |
| MCP agent interface | `npm run test:mcp` |
| Runtime UI/API flows | `npm run test:e2e` |
| Multi-persona scenario (M25) | `npm run test:e2e` — `scenario-agentic-airlines.spec.ts`; reusable fixture in `tests/e2e/support/scenario-agentic-airlines.ts` |
| ADR-0020 `@me` view filter performance | `npm run perf:me-filter -- --docs 10000 --runs 20`; local/dev measurements only |
| Deploy packaging | `npm run test:deploy` |
| Docker/compose shape | `docker compose -f deploy/compose.yml config` |
| Kubernetes manifests | `make k8s-dry-run` |

## Local MCP Helpers

```bash
make mcp-api      # foreground Lotus API for MCP testing
make mcp-reset    # explicit API reset
make mcp-test     # wrapper around npm run test:mcp
make claude-mcp-designer # launch Claude Code with generated Lotus designer MCP config
make codex-mcp-designer-install # persistently register Lotus designer MCP with Codex CLI
make codex-mcp    # launch Codex after verifying the registration
```
