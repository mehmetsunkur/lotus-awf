# MCP Adapter

## Doc Sync Metadata

- Last code review baseline: `1ffaf99`
- Last reviewed date: `2026-07-01`
- Code areas:
  - `src/mcp/**`
- Tests:
  - `tests/unit/workflow-patches.spec.ts`
  - `tests/mcp/**`
- Config/runtime areas:
  - `package.json`
  - `deploy/k8s/**`
- Review trigger:
  - Update this doc when MCP tools, auth flow, mutation safety rules, or MCP runtime assumptions
    change.

## Purpose

Model Context Protocol servers for coding agents. The adapter exposes three non-layered surfaces:
`lotus-admin`, `lotus-designer`, and `lotus-workspace`, over two transports — **local stdio** (one
process per user, env credentials) and **HTTP** (a multi-session host, per-session credentials). Both
call the existing Express API and import only pure shared validators/helpers.

## Main Files

- `src/mcp/admin-server.ts` — stdio MCP entrypoint for platform/app/access administration.
- `src/mcp/designer-server.ts` — stdio MCP entrypoint for app design, workflows, and templates.
- `src/mcp/workspace-server.ts` — stdio MCP entrypoint for business document work.
- `src/mcp/runtime.ts` — shared server construction; stdio connection plus
  `createLotusMcpServerWithClient` for per-session client injection.
- `src/mcp/http-server.ts` — HTTP host: serves all surfaces at `/mcp/<surface>` over
  StreamableHTTP, authenticates each session (Basic/Bearer), routes by session id, sweeps idle
  sessions.
- `src/mcp/http-config.ts` — env-only host config (port, surfaces, allowed hosts/origins, TTL).
- `src/mcp/lotus-client.ts` — HTTP client, username/password login, session-cookie replay (including
  a pre-supplied Bearer token), typed API errors.
- `src/mcp/tools/admin.ts` — admin tool registration.
- `src/mcp/tools/designer.ts` — designer tool registration.
- `src/mcp/tools/workspace.ts` — workspace tool registration.
- `src/mcp/workflow-patches.ts` — pure workflow patch operations used by preview/apply tools.
- `src/mcp/tool-result.ts` — JSON/error result helpers.

## Key Flows

- Auth (stdio): login through `POST /api/session/login`, capture `lotus_session`, replay the cookie
  on API calls, and retry login once on `401`.
- Auth (HTTP): the caller presents an `Authorization` header on `initialize` — Basic
  (`username:password`, host logs in) or Bearer (existing `lotus_session` token, replayed). The host
  builds one `LotusClient` per MCP session and proves identity via `GET /api/session`; the principal
  is always resolved server-side, never caller-supplied. Sessions are bound to their surface and
  evicted on close/DELETE/idle-TTL.
- Admin tools: session/platform state, installed apps, app creation, and app ACL management.
- Designer tools: app definitions, workflow scaffolds, document-type scaffolds, template
  export/diff/apply/validation, and workflow patch preview/apply.
- Workspace tools: definitions/view discovery plus business document list/query/get/create/update and
  workflow transitions.
- Validation tools: designer definitions use `src/shared/definition-validation.ts`; template artifacts
  use `src/shared/template-validation.ts`.

## Existing Patterns

- MCP code is a client adapter, not a backend authority.
- The three servers are composable, not layered. Register multiple servers when a user/session needs
  multiple capability sets.
- Every app-scoped tool requires explicit `appId`.
- Tools return structured JSON as text content for broad MCP client compatibility.
- Mutating tools prefer existing API endpoints and shared validation over custom write behavior.

## Invariants

See `docs/invariants.md`: **MCP agent interface** (both the tool-adapter rule and the HTTP host
per-session-identity rule), **Identity & sessions**, **Definitions-as-data contract**, **Validation
parity**, **ACL / readers**, and **Replication & conflict** govern this subsystem.

## Relevant Decisions

- `docs/decisions/0001-definitions-as-data.md`
- `docs/decisions/0010-directory-and-session-auth.md`
- `docs/decisions/0011-mcp-over-http.md`
- `docs/M24/02-tool-contract.md`

## Tests

- `npm run build`
- `npm run test:unit`
- `npm run test:mcp`

All three MCP suites share the **per-worker harness fixture** (`tests/mcp/support/fixtures.ts`),
which mirrors browser e2e: each Playwright worker gets an isolated CouchDB pair (testcontainers) plus
a locally-spawned Express server on a free port (`startHarness()` in `tests/support/harness.ts`), and
an auto `resetState` re-seeds between tests. The app-under-test runs as a real local process
(debuggable), only CouchDB is containerized, and there is no fixed port — so the suites never collide
with another listener (e.g. a forwarded `:3001`) and no `docker compose up` is required. Specs read
the worker-scoped `apiBaseURL`.

`npm run test:mcp` uses `playwright.mcp.config.ts` (workers:2, fullyParallel), launches all three MCP
servers over stdio against the worker's API through the official MCP client transport.

`npm run test:mcp:http` uses `playwright.mcp.http.config.ts` (workers:2, fullyParallel), runs the HTTP
host in-process against the worker's API, and drives it with the official StreamableHTTP client
transport. It covers unauthenticated rejection, per-session identity isolation (two Basic identities
resolve to distinct principals), surface routing, and a representative tool call per surface.

`npm run test:mcp:agent` uses `playwright.mcp.agent.config.ts` — an **opt-in / nightly** acceptance
tier, never on the PR gate. It runs the HTTP host in-process and drives real coding-agent CLIs
(`tests/mcp/agent/support/agent-driver.ts`) against it with natural-language tasks, asserting the
resulting lotus state (outcome oracle, not the tool-call transcript) — proving an autonomous agent
can discover and compose the tools to build/maintain apps and workflows. Two scenarios (maintain an
existing workflow; build a new app end-to-end) run as a **driver matrix** over every `AgentDriver`,
so each agent is exercised on the same tasks. `LOTUS_AGENT_DRIVERS` (comma-separated allowlist of
driver names — `claude-code`, `codex`; unset or `all` = every driver) selects which agents run,
regardless of which creds are present. The agent authenticates to the host with a per-run
`Authorization: Bearer <lotus_session>` token minted after the reset (`mintSessionToken`). Each driver
also self-skips independently, printing the reason via `console.warn`.

Agent scenarios are organized as a small test bed (`tests/mcp/agent/support/testbed.ts`). Fixture
scenarios install an isolated app through the public MCP/API flow — `lotus_admin_create_app`, then
`lotus_designer_apply_template` with the fixture template rewritten to the scenario app id — before
the agent runs. The current workflow-maintenance scenario uses the packaged expense template as
`agent-expense` so it can mutate fixture state without depending on the globally seeded `expense`
app. Create-from-empty scenarios (for example `leave-requests`) intentionally skip fixture install
and assert that the before-template marker says the app did not exist. A multi-docType approvals
fixture (`tests/mcp/agent/fixtures/approvals/template.json`, installed as `agent-approvals`) carries
two docTypes (`request` + `approval`) and a branching but loop-free request workflow; its scenario
tasks the agent with adding a `needs-info` rework cycle (`submitted -> needs-info -> submitted`)
without breaking the existing approve/reject branch. Test-only fixtures live under
`tests/mcp/agent/fixtures/` and must not be seeded. Both styles export before/after templates and
assert exact normalized design-definition diffs, not just final UI/API state.

Every real-agent run writes redacted diagnostics into the Playwright test output and attaches them
to `playwright-report-mcp-agent`. The default report always includes `manifest.json`, `exit.json`,
`events.jsonl`, `spawn.json`, `prompt.txt`, `final_message.txt`, and the oracle-exported app template
artifacts (`template-before-<appId>.json`, `template-after-<appId>.json`,
`template-diff-<appId>.json`, `template-validation-<appId>.json`). The before/after diff compares
normalized design definitions only, so volatile export metadata (`createdAt`, `version`,
`templateId`) does not count as a design change. Verbose artifacts such as `stdout.log`,
`stderr.log`, `raw_result.json`, and generated MCP/client config are attached on failure. Set
`LOTUS_AGENT_DIAGNOSTICS=full` to attach verbose artifacts for passing runs too. All diagnostic text
is redacted before it is written: suite tokens, minted `lotus_session` bearers, authorization
headers, `sk-*` keys, GitHub token shapes, and `REMOTE_AGENT_SECRET_*` values are replaced. The
artifacts provide local correlation data (run id, model, base URL, timestamps, exit code, byte
counts, and final text) for matching against LiteLLM logs; they do not by themselves prove
server-side LiteLLM receipt.

- **`ClaudeCodeDriver`** — `claude -p` with a temp `--mcp-config` (Bearer header). Reads the
  suite-namespaced `LOTUS_AGENT_CLAUDE_*` vars and maps them onto the provider-native `ANTHROPIC_*`
  the CLI reads; each falls back to its `ANTHROPIC_*` counterpart, so inside a Claude Code session
  (where `ANTHROPIC_*` are pre-injected) it runs with zero extra config. Scrubs the parent's
  `CLAUDE_CODE_*` nested-session vars. Usable credential: `LOTUS_AGENT_CLAUDE_TOKEN` (or
  `ANTHROPIC_AUTH_TOKEN`) + a base URL, or `ANTHROPIC_API_KEY`.
- **`CodexDriver`** — `codex exec` against an isolated `CODEX_HOME` whose `config.toml` declares a
  `litellm` model provider (`wire_api = "responses"`, `env_key = "LOTUS_AGENT_CODEX_TOKEN"`) and one
  `mcp_servers` entry per surface using `bearer_token_env_var` (Codex HTTP MCP is Bearer-only). stdin
  is closed so `codex exec` doesn't hang. Usable credential: `LOTUS_AGENT_CODEX_TOKEN` +
  `LOTUS_AGENT_CODEX_BASE_URL`.

Env contract — every suite-specific var is namespaced `LOTUS_AGENT_<DRIVER>_*`; each driver
self-skips (with a printed reason) without its own:
`LOTUS_AGENT_CLAUDE_BASE_URL` / `LOTUS_AGENT_CLAUDE_TOKEN` / `LOTUS_AGENT_CLAUDE_MODEL` (Claude; the
base-url/token fall back to `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`), `LOTUS_AGENT_CLAUDE_BUDGET_USD`
optional (cost cap, default `2.00`); `LOTUS_AGENT_CODEX_BASE_URL` / `LOTUS_AGENT_CODEX_TOKEN` /
`LOTUS_AGENT_CODEX_MODEL` (Codex). All may be supplied via a gitignored `.env` — the Playwright
configs import `tests/support/load-env.ts`, which loads `.env` without overriding any already-set var
(so inline `VAR=… npm run` and the Claude Code runtime's injected vars still win).

## Local Claude Code Testing

Use the Makefile targets for local Claude Code MCP sessions:

```bash
make mcp-api
```

Run that in one terminal to start the CouchDB pair and Lotus API. In another terminal, reset state
only when wanted:

```bash
make mcp-reset
```

Then launch Claude Code with a generated local MCP config:

```bash
make claude-mcp-designer
```

The generated config is written to `.tmp/claude-mcp.lotus.json` and is ignored by git because it
contains local credentials. Override defaults with environment variables:

```bash
LOTUS_USERNAME=admin LOTUS_PASSWORD=password123 MCP_API_URL=http://localhost:3001 make claude-mcp-admin
```

Use `make claude-mcp-admin`, `make claude-mcp-designer`, or `make claude-mcp-workspace` depending on
the surface needed for the session.

## Local Codex CLI Testing

Codex CLI manages MCP servers as persistent user config. Register the needed Lotus MCP surface
explicitly:

```bash
make codex-mcp-designer-install
```

Then launch Codex from the project root:

```bash
make codex-mcp
```

Inspect or remove the registration with:

```bash
make codex-mcp-list
make codex-mcp-designer-remove
```

Each install target reuses `MCP_API_URL`, `LOTUS_USERNAME`, and `LOTUS_PASSWORD`, and registers a
stdio server that runs from this repository:

```bash
bash -lc 'cd <repo> && npx tsx src/mcp/<surface>-server.ts'
```

Run `make mcp-api` in another terminal before launching Codex, and run `make mcp-reset` only when
you want to reset local test state.

## Common Pitfalls

- Writing directly to CouchDB from MCP instead of going through Express APIs.
- Letting a tool accept a caller-supplied principal instead of using the authenticated session.
- Adding arbitrary shell execution as an MCP tool.
- Applying workflow patches without first validating the changed definition.
- Mutating business documents or document `readers`/`authors` from MCP tools.
