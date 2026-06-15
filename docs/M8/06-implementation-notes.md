# 06 — Implementation Notes

## Implemented runtime behavior

M8 adds a server-authoritative, tick-driven agent runtime:

- `agent:*` definitions (schedule | on-change) run a registered `agent`-kind handler;
- `POST /api/agents/run` runs due scheduled agents and drains `_changes` since the `agent:state`
  checkpoint, writing durable `agentrun:*` records;
- `GET /api/agents` and `GET /api/agents/runs` expose definitions and run history;
- an optional `AGENTS_INTERVAL_MS` background loop calls the same tick (off by default and in tests).

The seed defines `agent:daily-digest` (schedule) and `agent:on-expense-change` (on-change), both
running the `record-activity` handler.

## Architecture

Matching/scheduling decisions are pure (`src/shared/agents.ts`), unit-tested and portable, exactly
like the workflow engine. The server orchestrates I/O (the `_changes` feed, the durable store, the
clock) around them. Agent handlers are server-only (`src/server/handlers/agents.ts`).

## Durability and correctness

Runs are written before the checkpoint advances; replays are idempotent (on-change deduped by
agentId + rev, scheduled gated by `lastRunAt`). Ticks are serialized in-process (a promise chain)
so an overlapping manual call and interval loop cannot read the same checkpoint and double-run or
409 the `agent:state` write. `runAgentHandler` never throws, so a failing handler
records `ok: false` without crashing the tick. `agentrun`/`agent:state` writes reappear in the feed
but are skipped (not `kind: "document"`) — no feedback loop.

## Verification performed

```bash
npm run build
npm run test:unit                       # 31 passed
npx playwright test tests/e2e/agents.spec.ts   # 4 passed
npm run test:e2e                        # full suite
```

## Known limitations and risks

- Single-node only — no distributed/HA scheduling or leader election.
- No automatic retry/backoff; a failed run is recorded, not retried.
- Agents are server-authoritative; devices do not run them, and offline-originated changes fire their
  on-change agents only once they reach the server node's replica.
- `GET /api/agents/runs` is unfiltered by `readers` (run records carry `sourceId`) — harmless under
  the single-`appUser` model, same posture as `GET /api/plugins/log`; filter by `canReadDocument` if
  the server becomes multi-principal (ACL aspect A5).
- The existing `_changes` drain reads the whole feed since the cursor each tick; fine at this scale,
  a candidate for `limit`/continuous mode under load.
