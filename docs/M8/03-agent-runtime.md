# 03 — Agent Runtime

## The tick

`POST /api/agents/run` runs one tick of `runAgents()` (server-side, against local CouchDB):

1. Load enabled `agent:*` definitions and the `agent:state` checkpoint.
2. **Scheduled:** for each schedule agent that `agentIsDue` at now, run its handler and stamp
   `lastRunAt[agentId]`.
3. **On-change:** drain `changesSince(lastSeq)`; for each changed business document, run every
   `agentMatchesChange` agent whose (agentId + rev) is not already recorded.
4. Write the `agentrun:*` records, then advance the checkpoint (`lastSeq`, `lastRunAt`).

A tick is the unit of work; the background loop (`AGENTS_INTERVAL_MS`, off by default) just calls the
same function on a timer.

## Durability and at-least-once

Runs are written **before** the checkpoint advances, so a crash in between causes a replay, never a
lost run. The replay is idempotent: on-change work is deduped by (agentId + rev) against the existing
`agentrun` records, and scheduled work is gated by `lastRunAt`. The change cursor means a processed
document is not re-seen on the next tick; `agentrun`/`agent:state` writes themselves reappear in the
feed but are skipped (not `kind: "document"`), so there is no feedback loop.

## Failure posture

`runAgentHandler` never throws: an unknown handler or a throwing handler becomes a closed-fail
result, recorded as an `agentrun` with `ok: false`. One bad agent can neither crash the tick nor stop
its siblings, and never reverts any document. There is no automatic retry in this foundation.

## Endpoints

- `POST /api/agents/run` — run one tick; returns `{ ok, ran, runs }`.
- `GET /api/agents` — list `agent:*` definitions.
- `GET /api/agents/runs` — list `agentrun:*` records (newest first).

## Offline boundary

Agents are server-authoritative: devices never run them, and the tick touches only the server node's
local replica and the shared pure matching code. The offline create/edit/transition paths are
unchanged. Firing agents from a device, or on reconcile of offline-originated changes, is out of scope
for this foundation.
