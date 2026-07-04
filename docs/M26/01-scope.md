# 01 - Scope

## In scope

- Persona-session support in the agent test bed: mint a `lotus_session` Bearer token **per
  airline persona** (`mintSessionToken` already takes any username) and open one MCP HTTP
  session per persona — one session = one identity, per the HTTP-host invariant. Personas
  get the **workspace surface only**; the admin/designer surfaces are not offered to
  persona agents.
- Reuse of the M25 airline fixture under the MCP per-worker harness: a small admin
  `APIRequestContext` helper (login as alice against the worker's `apiBaseURL`) so
  `seedAgenticAirlines()` seeds the same personas/org/apps before agent runs. Scripted
  (non-agent) seeding of any submitted requests a scenario needs pre-staged.
- Three persona scenarios in a new spec (`tests/mcp/agent/personas.spec.ts`) under the
  existing opt-in config, run as the same **driver matrix** (claude-code, codex):
  file-a-request, work-the-approval-inbox, and an adversarial ACL/guard boundary probe.
  See `02-agent-contract.md`.
- Outcome-oracle assertions only (scripted API reads after the run) — never the agent's
  tool-call transcript. Diagnostics/redaction reuse the existing
  `tests/mcp/agent/support/diagnostics.ts` mechanism unchanged.

## Out of scope

- Server, shared, or client runtime changes — the substrate is exercised, not modified.
- New MCP tools or surfaces, and any change to workspace tool authority (the MCP
  agent-interface invariant stands: no caller-supplied principals, no readers/authors
  mutation). If a scenario proves impossible without a new tool, that is a finding to
  surface, not a change to make inside M26.
- The platform's own agent runtime (Notes-style scheduled/event agents) — unrelated
  substrate; "agent" here means an external coding-agent CLI acting as a user.
- Multi-agent orchestration (agents messaging each other, shared conversations). Cross-
  persona flows are composed as sequential single-agent runs over shared server state.
- Adding this tier to the PR gate; it stays opt-in / nightly like the rest of
  `tests/mcp/agent`.
- Browser UI coverage of agent-created state (M25's UI spec already covers the human view).

## Taxonomy

- Subsystem: MCP Adapter (tests only — expected zero `src/**` diff), e2e/test support.
- Domain Area: Identity & sessions, access control, definitions-as-data (consumed),
  query & indexing (ADR-0020 `@me` consumed).
- Change Type: Feature (additive test tier).
- Risk Class: Agent interface safety, Security (ACL/readers), Authentication.
- Runtime Surface: MCP HTTP (`/mcp/workspace`).
- Ownership Boundary: project-owned throughout.
- Relevant ADRs: 0011 (MCP over HTTP), 0016 (appId-agnostic templates), 0018 (assignee),
  0019 (stamped approver + guard), 0020 (`@me` filters); M24/02-tool-contract.
