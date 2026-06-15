# 04 — Build Plan

## Step 1 — Contract + pure matching engine

Add the `agent:*` kind plus `agentrun`/`agentstate` runtime types and the `agent` handler kind. Add
`src/shared/agents.ts` (pure `agentIsDue`/`agentMatchesChange`/`agentRunKey`) and
`validateAgentDefinition`. Unit-test.

## Step 2 — Agent handler registry

Add `src/server/handlers/agents.ts` (agent-kind registry, `runAgentHandler` fail-closed) and a demo
handler; declare it in the manifest. Unit-test the fail-closed path.

## Step 3 — Durable store + checkpoint + orchestrator

Add `couch.changesSince`. Implement `runAgents()` (scheduled + on-change, durable `agentrun:*`,
`agent:state` checkpoint, at-least-once + dedupe). Add `POST /api/agents/run`, `GET /api/agents`,
`GET /api/agents/runs`, and an optional env-gated background loop (off by default).

## Step 4 — Definitions plumbing

Accept `agent:*` in `PUT /api/definitions`; include agents in `currentDefinitions` and template
export/diff/apply validation.

## Step 5 — Seed + e2e

Seed a scheduled and an on-change agent. Add `tests/e2e/agents.spec.ts` (scheduled run, on-change
firing, durable run + no double-run, template export).

## Step 6 — Docs

Add these M8 docs; add the Agent runtime invariant (with `Paths:`) and a taxonomy risk class;
reconcile the `docs/context/*` cards.

## Step 7 — Verify

`npm run build`, `npm run test:unit`, `npm run test:e2e`; run the Tier-3 multi-lens review on the M8
range.
