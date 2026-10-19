# Review lenses (Tier-3 multi-lens review)

The adversarial review prompts for the **detective layer** — the multi-lens review workflow
(`.claude/workflows/review-change.js`). The cheap, always-on layer is the invariant hook
(`docs/invariants.md`) + `/preflight`; this file is the expensive layer, reserved for Tier-3
substrate changes (replication, ACL, contract, index seeding) and milestone boundaries.

Each lens corresponds to an aspect/category in `docs/invariants.md`. The workflow spawns one
**isolated** reviewer per *activated* lens (routed by the trigger paths in `docs/invariants.md`),
adversarially verifies each gating finding, then synthesizes a gated report.

## Shared preamble (prepended to every lens)

> You are one of several independent reviewers. Review **only** through the single lens below;
> other reviewers own everything else — out-of-lens or duplicate findings are noise.
> Input: a *plan* or a *diff* (MODE is stated) plus the cited source/docs. Read the cited code
> before asserting anything.
> Output: findings as `{ lens, severity: blocker|major|minor|note, file, line, claim, rationale,
> blastRadiusRefs, suggestedFix, confidence }`. Cite `file:line`. If your lens is clean, say so and
> return none — do not invent issues. Every finding will be independently refuted.

### Mode framing

- **MODE = plan** → "Is this aspect addressed in the plan? What is missing or unstated?"
- **MODE = diff** → "Does the implementation correctly handle this aspect?"

## Lenses

Each lens applies the same-named rule in `docs/invariants.md`, deepened into adversarial questions.

- **A1 Definitions contract** — Does the change break documents already replicated to clients
  (new required field, renamed/removed field, changed `type`/semantics)? Is there a default or
  migration? Read `docs/M2/02-data-contract.md`, `src/shared/types.ts`, `src/server/seed-data.ts`.
- **A2 Validation parity** — Is a rule enforced on only one of the client/API paths? Can a payload
  the client accepts be rejected by the API (or vice versa)? Does anything bypass `src/shared`?
- **A3 Expression runtime** — Does this widen evaluation unsafely (eval escape, host/global access,
  network, unbounded loops)? Still deterministic and portable client/server? Fails closed on
  malformed/hostile input?
- **A4 Replication & conflict** — Does it break bidirectional sync, create conflicts the UI can't
  represent, or mishandle `_rev`/`_conflicts` (dropping a rev, resolving without deleting the
  loser)? Does a shape change break conflict comparison?
- **A5 ACL / readers** — Does it expose a doc/field/row/option to a user without app access
  (ADR-0026: visibility is the app ACL — there are no per-document `readers`)? Does every read
  path, including cross-app lookups and aggregates, check the caller's level on the TARGET app?
  Are `authors` correct, and does an edit path still require Author+ plus Layer 2?
- **A6 Offline** — Does it add a hard dependency on the server replica or network for an action
  that must work offline (create, edit, validate, list, populate a select)?
- **A7 Index & query** — Does a new view sort/filter need an index that does not exist? If an index
  changed, was it updated in all THREE seeding sites? Does `use_index` cover the sort fields?
- **A8 Docs & acceptance** — Does the change alter behavior/contract a doc describes without
  updating it? Does any acceptance criterion now assert something false? Name the doc/criterion.
- **A9 Correctness** — Plain logic bugs: off-by-one, bad conditionals, unhandled null/undefined,
  async/await mistakes, state races, swallowed errors. Do not restate domain-lens findings.

## Verification & gating

A finding is not actionable until it survives an independent **refuter** that tries to prove it a
non-issue (default `refuted: true` unless concrete harm is shown). Gating: `blocker` → not done;
`major` → fix or waive with a reason; `minor`/`note` → recorded. A **completeness critic** flags any
activated lens that produced neither a finding nor an explicit all-clear, and any changed file no
reviewer opened.
