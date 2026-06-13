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

## Artifacts

| File | Role | Status |
|---|---|---|
| [`aspect-taxonomy.md`](./aspect-taxonomy.md) | **Keystone.** The enumerated aspects + the blast-radius trigger table that routes a change to its lenses. | Drafted |
| `lens-mandates.md` | The per-aspect reviewer prompts (one single-aspect, adversarially-framed mandate each). | TODO |
| review workflow | Reusable multi-agent fan-out (review → adversarial verify → synthesize → gate), parameterized by the taxonomy; runnable on a **plan** or a **diff**. | TODO |

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
