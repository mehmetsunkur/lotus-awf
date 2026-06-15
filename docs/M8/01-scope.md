# 01 — Scope

## M8 objective

Establish the agent-runtime foundation: replicated `agent:*` definitions run a registered `agent`-kind
handler on a schedule or on a document change, server-authoritatively, with durable run records.

## The execution model (key decision)

Agents are **server-authoritative and tick-driven**. A `POST /api/agents/run` endpoint runs due
scheduled agents and drains the `_changes` feed since a checkpoint — mirroring the existing explicit
`POST /api/replicate` idiom. An optional background loop (`AGENTS_INTERVAL_MS`) calls the same
function for an always-on node, but is **off by default and in tests**, which keeps agent behavior
deterministic to test and avoids duplicate runs across the dual-replica / multi-instance setup.

Devices do **not** run agents (this is workflow Option B applied to automation): the server runs them
and results replicate like any other local write.

## In scope

- The `agent:*` definition kind (trigger + handler), with pure matching/scheduling in `src/shared/agents.ts`.
- **schedule** (interval / due-since-last-run) and **on-change** (`_changes`, optional docType filter) triggers.
- An `agent`-kind handler registry (`src/server/handlers/agents.ts`).
- Durable `agentrun:*` records + an `agent:state` checkpoint (`_changes` cursor + per-agent last-run).
- At-least-once + idempotent execution (dedupe by agentId + rev); fail-closed per run.
- `agent:*` in the definition editor and template export/diff/apply.
- `POST /api/agents/run`, `GET /api/agents`, `GET /api/agents/runs`.

## Out of scope

- Distributed/HA scheduling, leader election, Temporal — single-node only.
- Automatic retry/backoff of failed runs (a later hardening item).
- On-device / offline agent execution (stays server-authoritative).
- On-transition as a distinct trigger (a transition is a change; expressible via on-change).
- Long-running orchestration, fan-out, sagas, external-system connectors.
- Production authorization for the agent endpoints (same non-production posture as M4–M7).

## Product framing

M8 is the Notes "agent" analog re-centered on offline-first: scheduled and event-driven automation
that a developer writes as a handler and a citizen wires up as a replicated `agent:*` definition.
