# 05 — Acceptance

## Demo scenario

1. Reset/seed the app (defines a scheduled and an on-change agent).
2. `POST /api/agents/run`; confirm the scheduled agent ran and a durable run was recorded.
3. Create an expense; tick again; confirm the on-change agent ran for that document (`sourceId`).
4. `GET /api/agents/runs`; confirm the runs are persisted.
5. Tick a second time with no new work; confirm `ran: 0` (checkpoint + dedupe + not-yet-due).
6. Export the app template; confirm `agent:*` definitions are included and `agentrun:*` / `agent:state`
   are not.
7. Save an agent definition referencing an unknown or wrong-kind handler; confirm it is rejected.

## Exit criteria

M8 is complete when the project can prove:

- a scheduled agent runs on a tick and records a durable run;
- an on-change agent fires for a matching document change;
- runs are durable and a repeated tick does not duplicate already-done work;
- a failing agent handler records a failed run without crashing the tick (unit-verified);
- `agent:*` definitions promote via the template artifact while runtime docs do not;
- an invalid agent definition is rejected on both tiers (fail closed).
