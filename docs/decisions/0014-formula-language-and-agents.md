# ADR-0014: Formula language with cross-DB reads, and formula-defined agents

Date: 2026-07-01

## Status

Proposed. Phase 1 (read-side formula fields) implemented; Phases 2–3 pending.

## Context

lotus-notes is a **code-as-data** platform: an app's behavior should live in its
replicated definitions, not in the base binary. The org.nsf prototype (ADR-0013, held on
`feat/org-nsf-derived-groups`, never merged) violated this by baking app-specific TypeScript
(`deriveOrgGroups`/`reconcileDerivedGroups`, an `org` appId) into `src/server`/`src/shared`.

To let apps like org.nsf ship as pure data, the base needs two *generic* capabilities:
1. **Cross-database reads in the formula language** — Notes-style `@DbColumn`/`@DbLookup`.
2. **Formula-defined agents** — data-declared triggered logic that reads/writes across DBs.

A spike (`docs/spikes/formula-dblookup-findings.md`) validated the risks: ACL scoping is
clean via the shared access helpers; async is containable with a two-lane engine; offline is
a constraint (lookups read the local replica), not a blocker.

## Taxonomy

- Subsystem: Shared, Server, Client
- Domain Area: Definition contract (formula), Identity & ACL, App lifecycle (agents)
- Risk Class: Contract / back-compat, Security (ACL), Offline parity
- Runtime Surface: Internal API, Web UI

## Decision

**Two evaluation lanes.** `src/shared/expression.ts` stays the pure, synchronous lane for
the six existing sites (`guard`, `validate`, `visibleWhen`, `readOnlyWhen`, `requiredWhen`,
portable search) — identical verdicts on every tier, no I/O, **no lookups**. A new async
lane `src/shared/formula.ts` permits `await DbColumn/DbLookup`.

**Read functions.** `@DbColumn(appId; docType; column)` (set-based) and
`@DbLookup(appId; docType; keyColumn; key; valueColumn)` (first match). Both are ACL-scoped
through `canReadDocument`/`principalsFor` and resolve the **local replica** (offline-first,
eventual consistency). The sandbox keeps the deny-list; `await` is permitted; a broken
formula fails closed to `undefined`.

**Where lookups are allowed:** async, tolerant contexts only — formula fields (Phase 1),
formula view columns (later), agent formulas (Phase 2). Never the sync lane; enforced by
`validateFormulaField`, which routes formula fields around the sync `validateExpression`.

**Formula-defined agents (Phase 2).** `AgentDefinition` gains a `formula` variant beside the
compiled `handler` name. It is evaluated in `runAgentsOnce` under an app-scoped
**`service:<appId>` principal**; the formula returns a desired write-set that the runtime
materializes ACL-checked with reconcile/prune, local-only best-effort offline (lifting the
held org prototype's `reconcileDerivedGroups`).

**`service:<appId>` security model (Phase 2).** Installing an app records the explicit
cross-DB grants its service principal needs (e.g. org grants `service:org` the `names_app`
group write). `appAccessLevel`/`canReadDocument` recognize service principals via those
declared grants — the minimum authority for the agent to do its job, auditable per app.

## Alternatives considered

1. **Compiled per-app code** (the reverted org prototype) — rejected: puts app-specific code
   in the base binary, the exact thing this ADR removes.
2. **Inline async everywhere** (one lane) — rejected: would make guards/validation async and
   tier-dependent, breaking validation parity and portable search.
3. **Declarative pre-resolve (Model B)** — deferred: keeps the hot path sync/cacheable, but
   only handles static dependencies. Start with inline-async (simpler, Notes-like); add
   pre-resolve later as an optimization.
4. **Triggering-actor / installer principal for agents** — rejected: derivations must read
   rows the actor can't (all employees), and scheduled agents have no actor. Hence
   `service:<appId>`.

## Consequences

- Positive: apps express cross-DB logic as data; org.nsf (and eventually the expense sample)
  need no base code. ACL is enforced uniformly through the shared helpers.
- Positive: the pure sync lane and its parity/offline guarantees are untouched.
- Negative: a formula field's value needs server resolution (a cross-DB, ACL-scoped read), so
  it is blank offline — acceptable because it is display-only; the editable/validate/save path
  stays fully offline (formula fields are excluded from the payload lifecycle).
- Negative: the async lane widens the sandbox slightly (permits `await`); the deny-list still
  holds. A real parser is a later hardening.
- Negative: `@DbColumn`/`@DbLookup` read-then-filter; N+1 is bounded by a per-request memo and
  by preferring set-based `@DbColumn`. Indexed-view-backed reads are a later optimization.

## Follow-ups

- Phase 2: `AgentDefinition` formula variant + `service:<appId>` principal + reconcile/prune.
- Phase 3: re-express org.nsf as pure data (template + formula agent); confirm base carries no
  app-specific code. Stretch: retire the expense base specialization the same way.
- Run the multi-lens `review-change` workflow (Tier-3 substrate) each phase.
