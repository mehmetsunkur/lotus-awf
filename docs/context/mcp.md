# MCP Adapter

## Doc Sync Metadata

- Last code review baseline: `f213265`
- Last reviewed date: `2026-10-17`
- Code areas:
  - `src/mcp/**`
  - `src/operator/**`
- Tests:
  - `tests/unit/workflow-patches.spec.ts`
  - `tests/unit/directory-members.spec.ts`
  - `tests/unit/operator-prompt.spec.ts`
  - `tests/mcp/**`
  - `tests/e2e/agent-operator.spec.ts`
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
- `src/mcp/directory-members.ts` — pure group-membership merges and ACL `unresolvedPrincipals` for the admin directory and template-install tools.
- `src/mcp/tool-result.ts` — JSON/error result helpers.

## Key Flows

- Auth (stdio): login through `POST /api/session/login`, capture `lotus_session`, replay the cookie
  on API calls, and retry login once on `401`.
- Auth (HTTP): the caller presents an `Authorization` header on `initialize` — Basic
  (`username:password`, host logs in) or Bearer (existing `lotus_session` token, replayed). The host
  builds one `LotusClient` per MCP session and proves identity via `GET /api/session`; the principal
  is always resolved server-side, never caller-supplied. Sessions are bound to their surface and
  evicted on close/DELETE/idle-TTL.
- Admin tools: session/platform state, installed apps, app creation, app ACL management, and the
  names.nsf directory (ADR-0012): `lotus_admin_get_directory`, person create/update/set-password,
  and group create/update/add-members/remove-members over `/api/names/*`. The server enforces
  manager-only writes, member existence, and the last-active-admin rule; MCP adds no authority.
  Add/remove-members read the group, merge via `src/mcp/directory-members.ts`, and `PUT` the full
  list (last write wins); remove reports `notMembers`. Slugs and `person:*` members are normalized
  with the server's shared rules (`src/shared/directory.ts`). Passwords are accepted as sensitive
  write-only arguments. Template install (ADR-0016): `lotus_admin_list_templates` returns
  `availableTemplates`; `lotus_admin_install_template` deploys one as a NEW app via
  `POST /api/platform/apps` `fromTemplate` (`appId`/`title` default to the template's), seeding its
  fixed sample documents, and returns `unresolvedPrincipals` — ACL principals missing from the
  directory — so the agent can create them with the directory tools.
  ADR-0023: `lotus_admin_list_apps` returns each `AppInstall` including its optional `description`
  (a purpose blurb mirrored from `app:config` at install time), so an operator agent can pick the
  right app before reading its definitions.
- Designer tools: app definitions (full — `lotus_designer_get_app_definitions` reads the untouched
  `/definitions` endpoint), workflow scaffolds, document-type scaffolds, template
  export/diff/apply/validation, and workflow patch preview/apply.
- Workspace tools: app discovery, definitions/view discovery, plus business document list/query/get/create/update and
  workflow transitions. `lotus_workspace_list_apps` is the entry point — call it first to discover
  accessible `appId`s and the caller's `accessLevel` on each (`AccessibleApp[]`; backed by `GET /api/apps`,
  which filters `installedApps()` to those ≥ reader for the authenticated session). ADR-0023 Phase 2 makes definition discovery **progressive**:
  `lotus_workspace_get_app_definitions` returns a LEAN self-describing index (ids + kinds + titles +
  descriptions, no bodies — served by `/definitions/summary`), and `lotus_workspace_get_form(docType)`
  / `lotus_workspace_get_workflow(docType)` / `lotus_workspace_get_view(viewId)` fetch one full
  definition on demand (views keyed by id, N-per-docType). `lotus_workspace_get_document` returns
  `{ document, availableTransitions }` (the tool passes `client.getDocument(…, { transitions: true })`,
  which adds `?include=transitions`) so the operator sees the transitions it may fire right now — each
  with label, target state, ADR-0023 `description`, and guard-field `helpText` — computed by the same
  shared engine that authorizes the write. The `LotusClient.getDocument` default stays **bare** (no
  wrapper) so internal callers like the operator daemon (`src/operator/operator.ts`, which reads
  `session.payload`) are unaffected — only the workspace tool opts in.
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
- `docs/decisions/0023-self-describing-schema-and-scoped-reads.md`
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
`tests/mcp/http/workspace-personas.spec.ts` (M26) extends this tier with airline **persona**
coverage: a persona Bearer session resolves to that persona's principals, the ADR-0020 `@me`
`view:my-approvals` inbox routes per MCP session, and a workspace session's toolset contains only
`lotus_workspace_*` tools. Airline helpers shared by the MCP tiers live in
`tests/mcp/support/airline.ts` (admin context, per-worker `seedAgenticAirlines` wrapper,
`personaBearer` token minting over the M25 e2e fixture).

`npm run test:mcp:agent` uses `playwright.mcp.agent.config.ts` — an **opt-in / nightly** acceptance
tier, never on the PR gate. It runs the HTTP host in-process and drives real coding-agent CLIs
(`src/operator/agent-driver.ts` — promoted from test support in M28) against it with
natural-language tasks, asserting the
resulting lotus state (outcome oracle, not the tool-call transcript) — proving an autonomous agent
can discover and compose the tools to build/maintain apps and workflows — and, since M26, that an
agent holding only a persona's workspace session can operate an app as a business user. The
builder scenarios (maintain an existing workflow; build a new app end-to-end) and the persona
scenarios (below) run as a **driver matrix** over every `AgentDriver`, so each agent is exercised
on the same tasks. `LOTUS_AGENT_DRIVERS` (comma-separated allowlist of
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
without breaking the existing approve/reject branch. A larger field-services fixture
(`tests/mcp/agent/fixtures/field-services/template.json`, installed as `agent-field-services`) carries
dispatch, technician, inventory, and billing workflows; its scenario adds a customer-hold loop to
only the work-order workflow and asserts the neighboring workflows remain unchanged. Test-only
fixtures live under `tests/mcp/agent/fixtures/` and must not be seeded. Both styles export
before/after templates and assert exact normalized design-definition diffs, not just final UI/API
state.

The **persona suite** (`tests/mcp/agent/personas.spec.ts`, M26) is the workspace-side counterpart:
where `agent.spec.ts` proves an agent can *build* apps through the admin/designer surfaces, the
persona scenarios prove one can *operate* an app as a business end user. Each scenario seeds the M25
Agentic Airlines fixture, mints a persona `lotus_session` Bearer, and hands the driver **only** that
persona's `/mcp/workspace` session — the host resolves the identity server-side at initialize, so
everything the agent can see or do flows from the session. Three scenarios per driver: an employee's
agent files and submits a leave request (oracle: ADR-0018/0019 server stamps — approver, department,
responsible, readers — regardless of anything the agent supplied); a manager's agent works the requests
assigned to her without being told which view (the ADR-0020 `@me` inbox is the intended route; the
oracle asserts outcomes, and that a request assigned to another head was left untouched); and an
adversarially-tasked agent (self-approve + approve others') must produce **no security-relevant
change** — the oracle deep-equals a before/after security projection
(`tests/mcp/agent/support/state-snapshot.ts`: state, responsible, stamped approver/department, readers,
history length, document count), so a refusing model and a substrate-thwarted model both pass.
Pre-staging is scripted through persona request contexts; agents perform only the behavior under
test.

The **field-services persona suite** (`tests/mcp/agent/field-services.spec.ts`) extends that
workspace-side pattern to the test-only Field Services fixture. It creates Dispatch, Technician,
Inventory, and Billing directory personas, installs the fixture as `agent-field-services`, and hands
each driver only a persona Bearer session for `/mcp/workspace`. The scenarios cover representative
department work: Dispatch files/triages/converts a service request and creates a scheduled work
order; a technician starts work and requests parts; Inventory allocates parts and returns the work
order to the technician; Billing creates and sends an invoice for completed work; and an
adversarial technician prompt tries dispatch-only cancellation while the oracle asserts the work-order
security projection is unchanged. Three further scenarios probe branch-and-boundary behavior rather
than the happy path: Billing must read each draft invoice's linked work order, compute the correct
amount (billable hours x 180), then send the match but dispute the mismatch — the `dispute`
transition is guarded on a `discrepancyNote`, so a dispute without the reasoning artifact fails
closed. Inventory works two reservations from the same `requested` state and must allocate the
in-stock part (returning its work order to the technician) while backordering the out-of-stock one —
`backorder` is likewise guarded on a `shortageReason`. And an authors-only edit probe proves that
`canEditDocument` is authorship, not app ACL level: an Inventory persona who is a group editor but
not the author of a technician's work order is refused a direct payload edit (a scripted control PUT
returns 403 and the agent's own attempt leaves the document projection unchanged). The same spec also
has a Field Services working-day scenario:
it seeds a small handbook app from the bundled `kb` template, writes role job descriptions and
department procedures, prompts each shift with only the handbook app id plus the persona's job
description, then runs Dispatch -> Technician -> Inventory -> Technician -> Billing and asserts the
service request, work order, parts reservation, and invoice lifecycle closes without handbook drift.

The **digital-twin working day** (`tests/mcp/agent/twin.spec.ts`, M27) removes the scripted task
entirely: one test per driver seeds `seedDigitalTwin()`
(`tests/e2e/support/scenario-digital-twin.ts` — kb + turnaround apps under per-seed appIds, job
descriptions on the org chart, KB articles/procedures scoped by authorship, a staged morning state
of flights and expenses) and runs five sequential persona shifts (carol ×2, ivy, hank, grace). A
shift's prompt is ONLY the persona's job description fetched from the org app plus one bootstrap
pointer to the kb appId; prompt hygiene is a harness assertion (no other appId, no view/document
id, no tool name — with one carve-out: the expense app's fixed id is the English word "expense",
so the assertion bans the quoted form only, since the bare word appears in job-description prose). Per-shift oracles: liveness — every document in the shift's `@me` queue advanced
along an allowed workflow edge (approve/reject and ramp-check/ground both pass); safety — the
generalized security projection (`captureDocTypeProjection`/`withoutDocuments` in
`state-snapshot.ts`) of everything outside the queue deep-equals the pre-shift snapshot. An evening
oracle closes the day: all flights terminal with ADR-0018 hand-off cleared, the over-limit expense
rejected per the KB finance procedure, background sets identical to morning, audit events present
per flight. Retries are 1 in this suite (`test.describe.configure`) — a retry replays a whole
seeded day. See `docs/M27/`.

The **agent operator** (M28, ADR-0021) promoted the driver seam out of the test bed:
`AgentDriver` (claude-code/codex CLI spawning, budgets, redaction) and the diagnostics
writer now live in `src/operator/` (`agent-driver.ts`, `container-agent-driver.ts`,
`diagnostics.ts`) and the agent
suites import them from there — runtime code never imports from `tests/`. The operator
daemon itself (`src/operator/operator.ts`, `npm run agent-operator`) is an authenticated
API client in this host's mold (ADR-0011 rules verbatim: session identities, no CouchDB,
no new authority). Its poll loop gates on the ADR-0022 cross-app work-queue
(`lotus-client.ts`'s `workQueue()` → `GET /api/work-queue?items=true`) rather than a single
per-app inbox view: one aggregate read answers "do I have work anywhere?" and hands back the
requested `agent-session` refs to claim — the responsible routing is still an ADR-0018/0020/0025
`@me` queue, and the `claim` transition stays the authoritative dedupe. Shift prompts come from the shared `src/operator/prompt.ts`
the M27 working-day spec asserts hygiene on. Its lifecycle is covered by a deterministic
FakeDriver spec on the PR gate (`tests/e2e/agent-operator.spec.ts`) plus one real-driver
session in this opt-in tier (`tests/mcp/agent/operator.spec.ts`).

Pitfall: MCP server keys handed to the drivers must follow the `lotus-<surface>` convention. Bare
`workspace` is a **reserved MCP server name** in the claude CLI (≥2.1.x) — a `--mcp-config` entry
under that key is silently dropped at load (debug-level warn only), leaving the agent with no lotus
tools; a no-change oracle would then pass vacuously. The persona suite fences this by pairing the
boundary probe with positive-oracle scenarios in the same run.

Every real-agent run writes redacted diagnostics into the Playwright test output and attaches them
to `playwright-report-mcp-agent`. The default report always includes `manifest.json`, `exit.json`,
`events.jsonl`, `spawn.json`, `prompt.txt`, `final_message.txt`, `tool-transcript.jsonl` (one line
per MCP tool call — name plus input capped at 2 KB — distilled from the claude driver's
`stream-json` stdout, so the report shows the agent's side of the run, not just the spec's scripted
API steps), and the oracle-exported app template
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

- **`ClaudeCodeDriver`** — `claude -p` with a temp `--mcp-config` (Bearer header), run with
  `--output-format stream-json --verbose`: the NDJSON stream's final `result` line is the same
  envelope the plain `json` format printed (parsing contract unchanged), and the assistant lines
  feed `tool-transcript.jsonl`. Reads the
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
- **Container drivers** — `ContainerClaudeCodeDriver` and `ContainerCodexDriver` implement the same
  driver names but execute inside `Dockerfile.agent-runner` on the playground Testcontainers
  network. The runner sees an empty `/work`, an internal `lotus-mcp` URL, a persona Bearer token,
  and the selected provider env vars only. Artifacts are written inside `/diag`, copied back after
  exit/timeout, redacted through the normal diagnostics writer, and checked for isolation-policy
  violations before a run may pass. Container Claude runs additionally deny non-MCP built-ins
  (shell, file, search, web, sub-agent, worktree, and orchestration tools) so persona work stays on
  `lotus-workspace`. Container Codex runs use `codex exec --json`; container Claude keeps
  `stream-json`. Both streams are normalized into `agent-events.jsonl`, `tool-transcript.jsonl`,
  `turn-summary.json`, and `timeout-diagnostics.json`, so a timeout states whether it stalled before
  structured events, during provider retry/reconnect, before MCP connection, after MCP connection
  but before a turn, during a turn without tools, during/after tool calls, or after turn completion
  but before finalization.

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
