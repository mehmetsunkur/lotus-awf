# Playground

## Doc Sync Metadata

- Last code review baseline: `20c7a06`
- Last reviewed date: `2026-07-22`
- Code areas:
  - `scripts/playground.ts`
  - `src/operator/container-agent-driver.ts`
  - `tests/support/harness.ts`
  - `tests/support/containerized-harness.ts`
  - `tests/mcp/agent/support/field-services.ts`
  - `tests/mcp/agent/support/field-services-scheduler.ts`
  - `tests/mcp/agent/support/testbed.ts`
- Tests:
  - `tests/mcp/agent/field-services.spec.ts`
  - `tests/unit/container-agent-driver.spec.ts`
  - `tests/unit/field-services-scheduler.spec.ts`
  - `tests/e2e/work-queue.spec.ts`
  - `tests/mcp/agent/support/**`
- Config/runtime areas:
  - `package.json`
- Review trigger:
  - Update this doc when playground commands, company bootstraps, sidecar lifecycle, diagnostics
    layout, or agent-spawn behavior changes.

## Purpose

The playground is a local, throwaway company testbed runner for manual exploration and real-agent
experiments. It starts an isolated Testcontainers Lotus stack, seeds a company template, starts the
MCP HTTP host, prints browser/API/MCP endpoints, optionally starts sidecar containers, and can spawn
persona-scoped real-agent shifts.

V1 is CLI-first: `npm run playground -- field-services`. It is intentionally a development harness,
not a production backend authority.

By default, the playground uses `--runner container`: CouchDB, the Lotus API, the MCP HTTP host, and
real-agent shifts all run as containers on one private Testcontainers network. The host-side
playground process remains the controller for seeding, queue probes, snapshots, and diagnostics.
`--runner host` keeps the older local Express/MCP process and host CLI driver path for debugging.

## Main Files

- `scripts/playground.ts` — CLI entrypoint. Boots Lotus, starts MCP HTTP, seeds companies, starts
  optional sidecars, runs persona shifts, and writes diagnostics under `.lotus-playground/runs/`.
- `Dockerfile.agent-runner` — isolated real-agent runner image with Codex and Claude Code installed;
  it runs as the non-root `node` user and contains no project checkout.
- `src/operator/container-agent-driver.ts` — containerized `AgentDriver` implementations for Codex
  and Claude Code. They copy prompt/config into the runner, pass only selected provider/MCP env vars,
  redirect stdout/stderr/final output under `/diag`, copy `/diag` back, and apply isolation policy
  checks before reporting success. Claude container runs also explicitly disallow non-MCP built-ins
  such as shell, file, search, web, sub-agent, worktree, and orchestration tools.
- `src/operator/agent-stream.ts` — shared parser for Codex `--json` and Claude `stream-json`
  output. It writes normalized agent events, tool transcripts, turn summaries, and timeout
  classification artifacts for container runs.
- `tests/support/containerized-harness.ts` — containerized playground harness: CouchDB pair, Lotus
  API container, and MCP HTTP container on one private network with aliases `lotus-api` and
  `lotus-mcp`.
- `tests/support/harness.ts` — isolated Lotus stack: private Docker network, local/server CouchDB
  containers, and local Express process on a free port. The playground uses its exposed
  `network` handle for optional sidecars when `--runner host` is selected.
- `tests/mcp/agent/support/field-services.ts` — reusable Field Services company bootstrap:
  personas, directory groups, fixture install, handbook seed, and job descriptions.
- `tests/mcp/agent/support/mcp-host.ts` — starts the in-process MCP HTTP host against the harness API
  and mints persona Bearer tokens.

## Usage

```bash
npm run playground -- field-services
npm run playground -- field-services --runner host
npm run playground -- field-services --once
npm run playground -- field-services --sidecar mailpit --sidecar nginx
npm run playground -- field-services --run dana --driver codex --model gpt-5-codex --once
npm run playground -- field-services --run-day --driver claude-code --model claude-sonnet-4-5
npm run playground -- field-services --watch-work --max-runs 0 --once
```

The command prints:

- Lotus Web/API URL and seeded app URLs.
- MCP URLs for `admin`, `designer`, and `workspace`.
- The internal runner MCP URL (`http://lotus-mcp:3002/mcp/workspace`) when using container runners.
- Local fixture logins: `alice / password123` plus Field Services personas using the shared fixture
  password.
- Optional sidecar URLs.
- Diagnostics root for spawned agent runs.

## Agent Spawning

`--run <persona>` is a manual shift. Before launching the driver, the playground reads the Field
Services operations app and probes `/api/work-queue?items=true` for that persona. If the company has
no detected work for the persona, the playground refuses the spawn unless `--empty-ok` is supplied.

`--run-day` seeds a deterministic morning service request, transitions it to Dispatch triage, and
then runs the queue scheduler. The scheduler polls the company, logs every persona's work-queue count
and Field Services spawn decision, spawns one relevant persona at a time, waits for that run to
finish, and polls again until it reaches `--max-runs` or `--idle-polls`.

`--watch-work` runs the same scheduler without seeding morning work. Use `--max-runs 0` with either
scheduler mode to probe queue state and write a snapshot without selecting or launching an agent
driver.

Field Services spawn policy is company-specific and intentionally separate from the generic
`/api/work-queue` aggregate:

- `dana` handles triaged service requests.
- `taylor` handles scheduled, parts-ready, or newly created work orders, plus allocated parts pickups.
- `iris` handles requested/backordered parts reservations and work orders waiting on parts.
- `blake` handles completed uninvoiced work orders and draft/disputed invoices.

The scheduler writes compact document snapshots under `.lotus-playground/runs/<timestamp>/` so a run
can be inspected without replaying agent diagnostics. It tracks attempted spawn keys for the current
process, so an unchanged failed/no-op item is not respawned repeatedly in the same scheduler run.

## Boundaries

- The playground orchestrates existing public surfaces: Express API, MCP HTTP, Testcontainers, and
  real-agent drivers. It must not write CouchDB directly.
- Persona runs receive only a Bearer-authenticated `/mcp/workspace` server named
  `lotus-workspace`; the MCP host resolves identity server-side.
- Scheduler queue/state facts are used only by the playground controller for spawn gating and logs;
  they are not injected into the agent prompt.
- Containerized persona runs receive only the internal `lotus-workspace` MCP URL and a persona Bearer
  token. They do not mount the repo, tests, `.env`, CouchDB credentials, or host workspace.
- Claude container runs allow only `mcp__lotus-workspace__*` tools and deny common built-ins that
  could route around the workspace MCP boundary, including worktree/orchestration tools that Claude
  may advertise in non-bare mode.
- Containerized runner diagnostics include `isolation-policy.json`; runs fail if stdout/stderr/final
  text references the repo checkout, MCP fixture paths, direct CouchDB URLs, or direct Lotus API
  routes.
- Containerized runner diagnostics also include `agent-events.jsonl`, `tool-transcript.jsonl`,
  `turn-summary.json`, and `timeout-diagnostics.json`. Timeout classifications distinguish no
  structured events, provider retry/reconnect, MCP not connected, MCP connected with no turn, agent
  turn without tools, slow/tool-loop behavior, and completed turn without finalization.
- `--model` is a per-run CLI override for the selected driver's existing model environment
  (`LOTUS_AGENT_CODEX_MODEL` or `LOTUS_AGENT_CLAUDE_MODEL`) and requires `--driver`.
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
- `npx vitest run tests/unit/field-services-scheduler.spec.ts`
- `npx playwright test tests/e2e/work-queue.spec.ts`
- `npm run playground -- field-services --once`
- `npm run playground -- field-services --runner host --once`
- `npm run playground -- field-services --run-day --max-runs 0 --once`
- `npm run playground -- field-services --watch-work --max-runs 0 --once`
- `npm run playground -- field-services --sidecar nginx --once`
- `npm run test:mcp:agent -- --list` or
  `npx playwright test -c playwright.mcp.agent.config.ts --list` to confirm the acceptance suite
  still discovers Field Services tests.
