# Playground

## Doc Sync Metadata

- Last code review baseline: `90dd67b`
- Last reviewed date: `2026-07-22`
- Code areas:
  - `scripts/playground.ts`
  - `tests/support/harness.ts`
  - `tests/mcp/agent/support/field-services.ts`
  - `tests/mcp/agent/support/testbed.ts`
- Tests:
  - `tests/mcp/agent/field-services.spec.ts`
  - `tests/mcp/agent/support/**`
- Config/runtime areas:
  - `package.json`
- Review trigger:
  - Update this doc when playground commands, company bootstraps, sidecar lifecycle, diagnostics
    layout, or agent-spawn behavior changes.

## Purpose

The playground is a local, throwaway company testbed runner for manual exploration and real-agent
experiments. It starts the same isolated Testcontainers Lotus stack used by e2e/MCP suites, seeds a
company template, starts the MCP HTTP host, prints browser/API/MCP endpoints, optionally starts
sidecar containers, and can spawn a persona-scoped real-agent shift.

V1 is CLI-first: `npm run playground -- field-services`. It is intentionally a development harness,
not a production backend authority.

## Main Files

- `scripts/playground.ts` — CLI entrypoint. Boots Lotus, starts MCP HTTP, seeds companies, starts
  optional sidecars, runs persona shifts, and writes diagnostics under `.lotus-playground/runs/`.
- `tests/support/harness.ts` — isolated Lotus stack: private Docker network, local/server CouchDB
  containers, and local Express process on a free port. The playground uses its exposed
  `network` handle for optional sidecars.
- `tests/mcp/agent/support/field-services.ts` — reusable Field Services company bootstrap:
  personas, directory groups, fixture install, handbook seed, and job descriptions.
- `tests/mcp/agent/support/mcp-host.ts` — starts the in-process MCP HTTP host against the harness API
  and mints persona Bearer tokens.

## Usage

```bash
npm run playground -- field-services
npm run playground -- field-services --once
npm run playground -- field-services --sidecar mailpit --sidecar nginx
npm run playground -- field-services --run dana --driver codex --once
npm run playground -- field-services --run-day --driver claude-code
```

The command prints:

- Lotus Web/API URL and seeded app URLs.
- MCP URLs for `admin`, `designer`, and `workspace`.
- Field Services personas and shared fixture password.
- Optional sidecar URLs.
- Diagnostics root for spawned agent runs.

## Boundaries

- The playground orchestrates existing public surfaces: Express API, MCP HTTP, Testcontainers, and
  real-agent drivers. It must not write CouchDB directly.
- Persona runs receive only a Bearer-authenticated `/mcp/workspace` server named
  `lotus-workspace`; the MCP host resolves identity server-side.
- Prompt assembly follows the working-day acceptance pattern: handbook app id plus job description,
  with a hygiene check that bans direct business app ids, document ids, view ids, and tool names.
- Sidecars are disposable Testcontainers joined to the harness network. They are advertised as URLs
  only until an explicit MCP/tool integration is added.

## Current Company Templates

- `field-services` — Northstar Field Services. Seeds Dispatch, Technician, Inventory, Billing, and
  Manager groups; installs the Field Services operations app; seeds a handbook app with role
  procedures; supports `dana`, `taylor`, `iris`, and `blake` persona shifts.

## Tests

- `npx tsc --noEmit`
- `npm run playground -- field-services --once`
- `npm run playground -- field-services --sidecar nginx --once`
- `npm run test:mcp:agent -- --list` or
  `npx playwright test -c playwright.mcp.agent.config.ts --list` to confirm the acceptance suite
  still discovers Field Services tests.
