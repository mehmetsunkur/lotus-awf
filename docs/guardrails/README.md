# Guardrails

Process guardrails for keeping the codebase on its key designs and patterns as it
grows — specifically when **AI coding agents** author most changes.

## The concern these address

A capable agent works well *given the right context*, but it has bounded
attention: it focuses on the slice in front of it and does not always **see the
other aspects** a change touches. The failure mode is not wrong syntax (types,
lint, CI catch that) — it is *"the agent never considered replication / never
updated the contract / never thought about ACL."*

You fix bounded attention two ways:

1. **Narrow the gap** — route the relevant aspects into the agent's context the
   moment it works in an area (so the single agent is less blind).
2. **Cover the residual** — review through one independent perspective *per
   aspect* (so what one misses, another catches).

Both require one thing first: an explicit, enumerated list of aspects. You cannot
ensure coverage of a dimension nobody wrote down.

## Two layers: preventive (default) vs detective (reserved)

Post-hoc review pays full marginal cost on every change and only finds what is
already wrong. Preventive guidance is a fixed cost with ~zero marginal cost — and
the cheapest bug is the one never written. So the **default** layer guides the
author *before/during* the change; the **expensive** review fan-out is reserved
for high-stakes (Tier-3 substrate) changes and milestone boundaries.

Both layers use the **same** substrate — the aspect taxonomy and the nine lens
mandates — applied at different moments.

## Artifacts

| File | Layer | Role | Status |
|---|---|---|---|
| [`aspect-taxonomy.md`](./aspect-taxonomy.md) | both | **Keystone.** The enumerated aspects + the blast-radius trigger table. | Drafted |
| [`lens-mandates.md`](./lens-mandates.md) | both | The nine per-aspect mandates + shared preamble and plan/diff framing. | Drafted |
| [`../../CLAUDE.md`](../../CLAUDE.md) | **preventive** | Always-in-context working agreement: layering + the "before you finish, map the aspects" protocol. | Drafted |
| [`../../.claude/hooks/aspect-router.mjs`](../../.claude/hooks/aspect-router.mjs) | **preventive** | PostToolUse hook: when an Edit/Write touches a blast-radius file, injects that file's aspect questions into the agent's context (non-blocking). Wired in `.claude/settings.json`. | Drafted |
| [`../../.claude/workflows/review-change.js`](../../.claude/workflows/review-change.js) | **detective** | Multi-agent fan-out (route → review per lens → adversarial verify → synthesize → gate). Reserve for Tier-3/milestone. | Drafted |

The taxonomy is the dependency for everything else — context routing, the
per-aspect reviewers, the plan checklist, and the definition-of-done all key off
it.

## How it's meant to be used

- **At plan time** — the plan must name which aspects it touches (per the trigger
  table) and which it deliberately leaves out. A plan that names no aspects is the
  tell.
- **At change time** — each touched aspect gets an independent reviewer; findings
  are adversarially verified before they surface; severity gates "done."

See [`aspect-taxonomy.md`](./aspect-taxonomy.md) for the list and the routing.
