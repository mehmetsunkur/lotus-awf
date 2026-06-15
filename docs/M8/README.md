# M8 — Agent Runtime

M8 gives the platform **agents**: replicated `agent:*` definitions that run a registered handler on a
trigger — on a schedule or when a document changes. This is the durable, triggered execution layer
M7 deferred ("durable retry/queueing — that is Phase-9 agents").

M1–M7 proved the replica substrate, the metadata runtime, workflow, authoring, security, template
promotion, and the plugin/handler runtime. M8 proves those same definitions-as-data can drive
**autonomous, server-authoritative automation** without breaking offline-first.

## Goal

- A replicated `agent:*` definition kind (trigger + handler), authored and promoted like any other.
- **Scheduled** and **on-change** (CouchDB `_changes`) triggers.
- Server-authoritative, **tick-driven** execution (`POST /api/agents/run`), like manual replication.
- **Durable** run records (`agentrun:*`) and a `_changes` checkpoint (`agent:state`).
- **At-least-once + idempotent**: deduped by (agentId + rev); a failing handler records a failed run
  and never crashes the tick.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary, the execution-model decision, non-goals |
| [02-agent-contract.md](02-agent-contract.md) | `agent:*` definition, triggers, run/checkpoint shape |
| [03-agent-runtime.md](03-agent-runtime.md) | The tick, scheduling, change draining, durability, endpoints |
| [04-build-plan.md](04-build-plan.md) | Implementation steps |
| [05-acceptance.md](05-acceptance.md) | Demo flow and exit criteria |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

M8 is the modern Notes "agents" substrate, not a distributed job platform.

The working question is:

> Can replicated `agent:*` definitions drive scheduled and change-triggered handler execution,
> server-authoritatively and durably, without duplicating runs or breaking offline-first?
