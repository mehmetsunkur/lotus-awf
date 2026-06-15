# 02 — Agent Contract

## Definition

```ts
type AgentTrigger =
  | { type: "schedule"; everyMs: number }
  | { type: "on-change"; docType?: string };

type AgentDefinition = {
  _id: `agent:${string}`;
  kind: "agent";
  appId: string;
  title: string;
  handler: string;      // a registered `agent`-kind handler (validated against the manifest)
  trigger: AgentTrigger;
  enabled?: boolean;    // absent means enabled; false defines but never fires
};
```

`agent:*` is a design document: it replicates, is edited through `PUT /api/definitions`, and is
carried in template export/diff/apply alongside forms, views, and workflows.

## Handler reference

`handler` must name a manifest entry of kind `agent`. Validation (`validateAgentDefinition`) fails
closed on an unknown name, a wrong-kind reference, a missing/invalid trigger, or a negative interval —
on both tiers, like every other definition.

## Runtime documents (never templated)

- **`agentrun:<ulid>`** — a durable record of one execution: `agentId`, `trigger`, `sourceId`/
  `sourceRev` (on-change only), `startedAt`, `ok`, `detail`, `readers`.
- **`agent:state`** — the singleton checkpoint: the `_changes` `lastSeq` cursor and a per-agent
  `lastRunAt` map.

Both are runtime data (`kind: "agentrun"` / `"agentstate"`) — excluded from `currentDefinitions`, so
they never enter a template, and absent from business document/view queries (which select by kind).

## Matching engine (pure)

`src/shared/agents.ts` holds the decisions, deterministic and unit-testable:

- `agentIsDue(agent, lastRunAt, now)` — a never-run scheduled agent is due; otherwise due once
  `everyMs` has elapsed; non-schedule agents are never "due".
- `agentMatchesChange(agent, doc)` — an on-change agent matches a business document of its (optional)
  `docType` filter.
- `agentRunKey(agentId, sourceRev)` — the dedupe key for at-least-once execution.
