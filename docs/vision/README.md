# A Modern Lotus Notes / Domino

> A design analysis for building a Notes/Domino-class **application platform** on a modern,
> offline-first stack. Captured 2026-06-12 from a working discussion; this is a starting brief,
> not a committed spec.

## What this is

Lotus Notes/Domino was a *complete, flexible application platform*: a citizen developer could build
a whole workflow app — data model, forms, views, logic, security, and deployment — without leaving
the platform, and ship it as a single file. This folder analyses how to rebuild that experience with
today's tools.

The defining insight: **Notes wasn't great because of any one feature — it was great because it
*integrated* the entire app lifecycle into one coherent, low-code package.** The modern world has
*unbundled* every pillar (datastore, forms, workflow, sync, auth, search) into best-of-breed tools.
The product is the *re-integration*, not the components.

## Two requirements that shape everything

1. **Offline / replication is a hard requirement.** → the architecture is **local-first**, not
   server-authoritative. This is the single biggest driver of every downstream choice.
2. **Both developers and citizen/power-users author apps.** → a **dual-tier authoring** model:
   low-code studio for power-users + definitions-as-code/plugins for developers.

## Documents

| Doc | Purpose |
|-----|---------|
| [00-vision.md](00-vision.md) | Why build this, the "platform-ness" thesis, goals/non-goals |
| [01-notes-domino-anatomy.md](01-notes-domino-anatomy.md) | The key functions of Notes/Domino, decomposed into pillars |
| [02-architecture.md](02-architecture.md) | Target **offline-first / local-first** architecture + component diagram |
| [03-tech-stack.md](03-tech-stack.md) | Modern tech per pillar, the recommended stack, tradeoffs |
| [04-key-decisions.md](04-key-decisions.md) | The forks, open questions, and the decisions still owed |
| [05-build-sequence.md](05-build-sequence.md) | Spike-first phased build plan |
| [06-references.md](06-references.md) | Prior art, build-vs-buy, and what to study |

## The one decision that unblocks the next concrete step

**Where does the workflow engine run when offline?**

- **Option A — Optimistic local engine:** create, edit, validate, *and advance workflow state*
  offline; the server reconciles on sync. Most Notes-like, hardest.
- **Option B — Offline data, online workflow:** documents/forms work offline; *state transitions*
  require connectivity and queue. Simpler; covers most real cases.

Recommended posture: **A-capable substrate, B-by-default at launch.** See
[04-key-decisions.md](04-key-decisions.md).
