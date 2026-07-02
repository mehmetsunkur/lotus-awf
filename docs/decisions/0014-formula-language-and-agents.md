# ADR-0014: Formula language with cross-DB reads, and formula-defined agents

Date: 2026-07-01

## Status

Accepted for the **read side** (Phase 1 — formula fields — implemented). The **write side
is parked**: we are NOT committing to formula-defined agents. Whether the write side should be
formula-agents or a safer **declarative derivation rule** is an open question, revisited when a
concrete need (e.g. org.nsf as pure data) is scheduled. See "Write side (deferred, undecided)".

## Context

lotus-notes is a **code-as-data** platform: an app's behavior should live in its
replicated definitions, not in the base binary. The org.nsf prototype (ADR-0013, held on
`feat/org-nsf-derived-groups`, never merged) violated this by baking app-specific TypeScript
(`deriveOrgGroups`/`reconcileDerivedGroups`, an `org` appId) into `src/server`/`src/shared`.

To let apps like org.nsf ship as pure data, the base needs two *generic* capabilities:
1. **Cross-database reads in the formula language** — Notes-style `@DbColumn`/`@DbLookup`. (This ADR.)
2. **A data-driven reactive-*write* mechanism** — so derive-and-materialize logic is data, not
   base code. Needed for org.nsf, but its form is deferred and undecided (see status).

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

Scoping is **row-level `readers`**, deliberately: a lookup returns exactly the rows whose
`readers` the caller carries, in any app. It does NOT additionally gate on the target app's
`acl:rules` app-level access — a document's `readers` is the authority on who may see it, and
the same row-level model already governs views, search, and select-option sourcing. (If a
future need calls for app-level gating on cross-app reads, add it in `makeDbReader`.)

**Where lookups are allowed:** async, tolerant contexts only — formula fields (Phase 1),
formula view columns (later), agent formulas (Phase 2). Never the sync lane; enforced by
`validateFormulaField`, which routes formula fields around the sync `validateExpression`.

**Write side (deferred, undecided).** The read side stands on its own. A *write* mechanism is
still needed eventually to let an app (e.g. org.nsf) derive-and-materialize data across DBs as
pure data, but the form is intentionally left open:

- *Formula-defined agents* — an agent whose logic is a formula returning a write-set, run under
  an app-scoped `service:<appId>` principal. Most general, but executes author-supplied code
  that WRITES server-side (a larger security/DoS surface than the read lane, whose own fail-open
  and unbounded-loop risks are noted below), and formula is an awkward language for producing a
  document set + reconcile/prune.
- *Declarative derivation rule* — a data spec (source query + group-by key + target-doc template
  + reconcile policy) interpreted by a generic base engine. Non-Turing-complete, so most of the
  code-execution risk disappears; a clean fit for the group/rollup-materialization case, but less
  general than formula-agents.

Current lean: the declarative rule for the common case, keeping formula-agents only if a future
app needs arbitrary triggered writes. Not decided here.

## Alternatives considered

1. **Compiled per-app code** (the reverted org prototype) — rejected: puts app-specific code
   in the base binary, the exact thing this ADR removes.
2. **Inline async everywhere** (one lane) — rejected: would make guards/validation async and
   tier-dependent, breaking validation parity and portable search.
3. **Declarative pre-resolve (Model B)** — deferred: keeps the hot path sync/cacheable, but
   only handles static dependencies. Start with inline-async (simpler, Notes-like); add
   pre-resolve later as an optimization.
4. **Triggering-actor / installer principal for agents** — noted for the deferred write side:
   derivations must read rows the actor can't (all employees) and scheduled agents have no actor,
   so an app-scoped `service:<appId>` is the leading candidate *if* formula-agents are chosen.

## Consequences

- Positive: apps express cross-DB logic as data; org.nsf (and eventually the expense sample)
  need no base code. ACL is enforced uniformly through the shared helpers.
- Positive: the pure sync lane and its parity/offline guarantees are untouched.
- Negative: a formula field's value needs server resolution (a cross-DB, ACL-scoped read), so
  it is blank offline — acceptable because it is display-only; the editable/validate/save path
  stays fully offline (formula fields are excluded from the payload lifecycle).
- Negative: the async lane widens the sandbox slightly (permits `await`); the deny-list still
  holds. The read path fails closed on any blocked-token/compile/runtime error, and authoring
  rejects unparseable formulas, so a broken formula neither 500s the endpoint nor drops sibling
  values (`resolveFormulaFields` uses `Promise.allSettled`).
- Known limitation: a token-clean unbounded loop (`while(true)`) is not preventable by the
  deny-list and would hang the request (same as the pre-existing sync lane). A hard execution
  deadline needs a worker/VM and is deferred; do not expose the async lane to untrusted authors
  until then.
- Negative: `@DbColumn`/`@DbLookup` read-then-filter; N+1 is bounded by a per-request memo and
  by preferring set-based `@DbColumn`. Indexed-view-backed reads are a later optimization.

## Follow-ups

- Read side hardening (later): execution deadline for the async lane; indexed-view-backed reads.
- Write side (only when scheduled): decide declarative derivation rule vs formula-agents, then
  design it in a follow-up ADR. Re-expressing org.nsf as pure data is the first consumer.
- Run the multi-lens `review-change` workflow (Tier-3 substrate) for any write-side work.

## Amendment (2026-07-02, ADR-0017/0018)

The async lane's allowed contexts grow beyond tolerant display: the transition route now
resolves `approverFormula` (enforcement — empty resolution falls back to `requiredRole` or
denies) and `responsibleFormula` (assignee routing — empty resolution never fails the
transition), both server-side, ACL-scoped under the actor, against the local replica. The
known unbounded-loop limitation therefore now guards a write path, which raises the
priority of the execution-deadline follow-up.
