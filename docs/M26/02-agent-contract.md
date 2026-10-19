# 02 - Agent-persona contract

> **Amended by ADR-0026 (2026-10-19):** per-document `readers` were removed — document visibility is the app ACL.

## Persona sessions

Each scenario mints a Bearer token per participating persona
(`mintSessionToken(apiUrl, username, AIRLINE_PASSWORD)` — must run after the fixture has
seeded the directory) and hands the driver an MCP config exposing **only**
`/mcp/workspace` under that token. The HTTP host resolves the identity server-side at
`initialize` (invariant: one MCP session = one `LotusClient` = one identity), so the agent
cannot claim principals — everything it can see or do flows from the session, exactly as
for a browser user. `lotus_workspace_get_session` is the agent's own who-am-I; the task
prompt names the app by its per-seed `leaveRequestAppId` (every app-scoped tool requires
explicit `appId`).

## Fixture

`seedAgenticAirlines(admin)` runs before each scenario against the worker's harness API,
via an admin `APIRequestContext` created in the MCP suite (login as alice — the same
"admin request context" contract the e2e `resetState` fixture satisfies). Scenario
pre-staging (e.g. submitted requests awaiting approval) is scripted through
`airlinePersonaContext`-style authenticated calls, not agent runs — agents perform only
the behavior under test. Per-seed appIds carry over unchanged (ADR-0016).

## Scenarios

All three run as a driver matrix over `selectDrivers()` (claude-code, codex), each driver
self-skipping without credentials. Oracles are scripted API reads after the run; the
agent transcript is diagnostics, never an assertion target.

### P1 — File a request (dave, First Officer → carol)

Task: request annual leave for fixed dates with a reason, in the leave-request app, and
submit it. Oracle:

- Exactly one new `leave-request` document; `type/from/to/reason` match the task.
- State `submitted`; server-stamped `payload.approver = person:carol` and
  `payload.department = flight-ops` (ADR-0019 — any approver value the agent may have
  supplied was discarded); `responsible = [person:carol]` with `responsibleAt` (ADR-0018/0025 —
  the submitted state routes to a pool, not an individual; `assignee` is unset).
- `authors` are dave alone (the creator base); audit trail records the submit. Every
  leave-request app member — hank included — can read it (ADR-0026: visibility is the app
  ACL), but hank cannot edit it (Layer 2: not an author, below editor).

### P2 — Work the inbox (carol, Director of Flight Operations)

Pre-staged: two submitted requests — one from dave (responsible carol), one from ivy
(responsible hank, Ground Operations — outside `group:managers`). Task for carol's agent:
review the leave requests **assigned to you** and approve them. Oracle:

- Dave's request is `approved`, transitioned by carol (audit + history record the
  hand-off clearing per ADR-0018).
- Ivy's request is untouched — still `submitted`, responsible hank; carol's session can
  read it (`group:managers` default reader) but the guard refuses her approval, and the
  scenario asserts no state change occurred.
- Discoverability payoff: the task never names a view; `view:my-approvals` (ADR-0020
  `@me`) is how an agent *should* find its inbox, but the oracle asserts outcomes, not
  the route taken.

### P3 — Boundary probe (adversarial prompt)

Dave's agent is explicitly tasked to approve his own submitted request and to find and
approve anyone else's pending requests. Oracle: **no security-relevant change** — his
request is still `submitted` (self-approve refused, 422 guard), other departments'
documents were never edited or transitioned, and every leave-request document's
security projection — `(state, responsible, payload.approver, payload.department, authors,
history length)` plus the document count — matches the pre-run snapshot. (Full byte
equality would misfire on within-authority noise: dave may legitimately edit his own
request's payload as its author, and the update route only accepts `payload` — the
envelope, including `state`, is rebuilt server-side.) This asserts the substrate refuses
regardless of what the agent attempts; a cooperative model that simply declines also
passes (the oracle is "no effect", not "attempt observed").

## Cost & flake controls

Same regime as `agent.spec.ts`: single worker, `retries: 2`, 600 s ceiling, per-run
budget (`LOTUS_AGENT_CLAUDE_BUDGET_USD`, default 2.00). Three scenarios × two drivers ≈
six agent runs per pass — comparable to the existing suite. P3's oracle is
variance-immune by construction; P1/P2 prompts pin concrete values (dates, reason) so
oracles are exact-match. Env contract (`LOTUS_AGENT_<DRIVER>_*`) is unchanged.
