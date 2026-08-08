# ADR-0025: Standing responsibility (`responsible`) and individual assignment (`assignee`)

Date: 2026-08-08

## Status

Accepted.

Splits the ADR-0018 assignment envelope into two orthogonal, engine-stamped routing facts under
their honest names — the standing/pool **responsibility** and the **individual assignment** —
each populated by a symmetric per-state formula and written by the same single writer
(`applyTransition`). Taken as a **clean break** (no back-compat required; reseed, no backfill —
the ADR-0024 precedent). **Individual pickup ("claim") is modelled as an ordinary transition,
not a new engine operation** — so no second writer of any envelope field is introduced.

- **Amends ADR-0018**: the engine-stamped envelope field `assignee`/`assignedAt` is renamed
  `responsible`/`responsibleAt` **and widened `string`→`string[]`** (the materialized value now
  shares the name of the `WorkflowState.responsible`/`responsibleFormula` it comes from, closing
  0018's definition→envelope naming discontinuity, and recovers the multi-valued `$AWFSorumlu`
  shape); the freed `assignee`/`assignedAt` is **repurposed** to the *single* individual, fed by a
  new symmetric `WorkflowState.assignee`/`assigneeFormula`.
- **Amends-in-part ADR-0020 and ADR-0022**: their `assignee` selectors/templates/examples refer
  to the *standing* assignment and become `responsible`; text re-baselined.
- **Reuses ADR-0020 `@me`** verbatim on both fields. **Holds the ADR-0018/0024 line**: neither
  field is enforcement — assignment confers no access.

## Context

A document sitting in a state owned by a **team** is the common shape the current envelope names
awkwardly. ADR-0018 stamps one scalar, `assignee`, from the state's
`responsible`/`responsibleFormula` on entry; ADR-0020 fans a *group-valued* `assignee` out to
every member's `@me` inbox; ADR-0022 aggregates it cross-app. Together they answer **"which
team's queue is this in"** — but the field the *state* calls `responsible` lands on the
*envelope* as `assignee`, and a `group:*` "assignee" reads wrong. That discontinuity is the tell
that one scalar carries two facts:

- **the pool/team accountable** (backlog owned by `group:triage`), and
- **the individual currently on it** (the person the engine assigned, or who picked it up).

The scalar cannot carry both, and there is no channel to set the individual distinctly from the
pool. Because no back-compat is required, we fix the naming rather than bolt a third name on: the
pool field becomes `responsible`, and the freed `assignee` becomes the individual — each driven
by its own state formula, each stamped by `applyTransition`.

**Individual pickup is a transition.** The motivating "person grabs a backlog item" flow is a
state change — `backlog → in-progress` — not an in-place mutation. Picking up work moves it from
the unassigned pool into an assigned state; the assigned state's `assigneeFormula` stamps the
actor. This keeps the whole design inside the existing engine (one writer, existing guards) and
avoids a bespoke claim operation. (An in-place grab with *zero* state change was considered and
rejected — see Alternatives 1 — as it would require a second envelope writer for marginal gain.)

**Scope (v1) — a deliberate tradeoff.** This ADR supports **assignment-by-state**, not in-state
claim/release. A pool that wants "assigned vs. unassigned" must model it as two states (an
unassigned pool state and an assigned state). The gain is that all routing writes stay inside
`applyTransition` with the existing guards; the cost is that pickup is lifecycle movement, so a
pool cannot toggle an individual without a state change. In-state claim/release is a future ADR if
a real need appears (it would reintroduce the second-writer question — Alternatives 1).

**Why re-baseline three accepted ADRs instead of adding a field.** The cheaper move is additive: a
new `claimant` field beside today's `assignee`, touching nothing already shipped. It is rejected
(Alternatives 2) because it *permanently* entrenches ADR-0018's state(`responsible`)→envelope
(`assignee`) naming discontinuity for the same expressive power. Since back-compat is not required
(reseed, no backfill — the ADR-0024 precedent), a one-time rename buys lasting name-to-concept
clarity across the engine, list DSL, and cross-app queue; the entrenchment is the larger long-run
cost, so we pay the rename now.

## Taxonomy

- Subsystem: Shared (workflow engine + envelope/definition types), Server (list selectors +
  `/api/work-queue`), Client (display only), Templates.
- Domain Area: Definitions-as-data (workflow contract + envelope), Validation & expressions,
  Identity & ACL (adjacent — narrowing only), Query & indexing.
- Risk Class: Contract (clean-break rename of an engine envelope field + a symmetric definition
  addition), Security (routing-vs-enforcement boundary), Expression safety (a second async-lane
  formula).
- Runtime Surface: Internal API (list selectors, `/api/work-queue`), Web UI (display),
  MCP (workflow-patch designer surface for the new state fields).

## Decision

### 1. Two envelope fields, one writer each — both `applyTransition`

```ts
// STANDING (renamed from assignee/assignedAt) — the pool(s)/party(ies) the STATE holds accountable.
responsible?:   string[]; // set of person:*/group:*, from WorkflowState.responsible/responsibleFormula
responsibleAt?: string;   // one timestamp: when the set was last (re)stamped

// INDIVIDUAL (repurposed assignee/assignedAt) — the single person currently on it.
assignee?:      string;   // exactly one person:*, from WorkflowState.assignee/assigneeFormula
assignedAt?:    string;
```

**`responsible` is a set; `assignee` is exactly one.** This is the true `$AWFSorumlu` shape —
legacy AWFBase split standing responsibility (`Responsibles`, a multi-valued Notes item) from the
single drawn individual (`ResourceAssigned`). A set lets a state hold *heterogeneous* parties
accountable — `["group:triage", "person:supervisor"]` or two parallel teams — without minting a
synthetic group. `assignee` stays scalar because the individual on a document is one person by
definition. `responsibleAt` remains a single timestamp (the last time the set was stamped), not
per-element.

`responsible` **is** today's `assignee`, renamed **and widened to an array**: same single writer
(`applyTransition`), same stamp-from-state semantics, same **group fan-out** via `principalsFor`
(now applied per element), same **clear-on-final** rule. `assignee` is the individual, populated
from a new symmetric state formula. **Single-writer is preserved and extended: `applyTransition`
is the sole writer of both pairs.** No claim op, no second writer — the invariant only widens to
name the second field (Follow-Ups).

`TransitionEvent` records both values stamped on entry (`responsible?: string[]`, `assignee?`) so
`history[]` remains a complete hand-off log.

**Array handling (the cost of the set, made explicit):**
- **`@me` / list `in`** — `{ responsible: { $in: principalsFor(scope) } }` against an *array*
  field matches on **element membership** (the document's `responsible` array contains any caller
  principal). This is different selector behaviour from the scalar case and its index binding is
  re-asserted via `_explain` in e2e (ADR-0020 posture). `assignee in @me` is unchanged (scalar).
- **`responsibleAt`** — one scalar for the whole set (there is no per-party timestamp); a state
  that needs per-party timing is out of scope (it would be a set of sub-assignments, not this).
- **Empty vs absent** — the empty set is stored as field-absent (never `[]`), so `$in` never
  matches a document with no standing responsibility, consistent with the scalar `$exists` rule.

### 2. Symmetric definition: `WorkflowState.assignee` / `assigneeFormula`

`WorkflowState` gains an optional pair mirroring `responsible`/`responsibleFormula` exactly:

```jsonc
{ "name": "in-progress", "label": "In progress",
  "responsibleFormula": "\"group:triage\"",   // the team stays accountable
  "assigneeFormula": "user" }                  // the individual = whoever entered this state
```

- **State-level vs envelope-level `assignee` are distinct on purpose** (as with `responsible`):
  `WorkflowState.assignee`/`assigneeFormula` is the *source declaration* (author-time), and
  `BusinessDocument.assignee`/`assignedAt` is the *materialized value* the engine stamps from it.
  The name is shared deliberately so the definition→envelope mapping reads straight through.
- `assigneeFormula` wins over static `assignee`, and `responsibleFormula` over static
  `responsible`, when both are present (the precedence rule from ADR-0018).
- **`responsible` resolution → a normalized principal *array*.** Resolved in the **ADR-0014 async
  lane** under the transition actor's scope against the local replica, then each element normalized
  (only `person:*`/`group:*` survive; non-principals drop out); the result is deduped and stored as
  a set (empty → field-absent). **`assignee` resolution → exactly one `person:*`** (approver
  normalization, ADR-0017/0018 — an array yields its first valid element; a non-principal, *and a
  `group:*`, normalizes away** — the individual is a person, never a group). A malformed formula
  can never stamp a non-principal into either field.
- **Fail-open by default**: resolution failure stamps nothing and never fails the transition.
  Assignment is routing metadata (ADR-0018 §3). The self-claim shape `assigneeFormula: "user"`
  cannot fail — the acting principal is always present.
- **Opt-in fail-closed: `WorkflowState.requireAssignee?: boolean`.** For an assignment state whose
  *whole purpose* is to land on a person (a pickup target), `requireAssignee: true` makes entry
  fail-*closed* — if no `assignee` resolves, `applyTransition` rejects the transition rather than
  leaving the document in the state with no individual. This is the one deliberate exception to
  ADR-0018's "routing failure never fails a transition": here assignment *is* the point of the
  move, so a silent empty stamp would strand the document (out of the unclaimed board, absent from
  "My work"). Default remains fail-open; `"user"` states never need it.
  - **Definition validation (rejected at author time, `definition-validation.ts`):**
    `requireAssignee: true` on a **final** state (final always clears routing — a contradiction);
    and `requireAssignee: true` on a state declaring **neither** `assignee` **nor** `assigneeFormula`
    (guaranteed to fail every entry).
  - **Runtime edge (defined, not statically catchable):** a `assigneeFormula` that resolves only to
    a `group:*` counts as **"no assignee resolved"** for the gate (the group normalizes away), so
    under `requireAssignee` it rejects the transition rather than stamping a group into the
    person-only `assignee`.

### 3. Clear-then-stamp on every entry; both cleared on final

`applyTransition` **clears both pairs first, then stamps whatever the target state declares** —
on *every* state entry, not only final ones. Full replace, never merge: a target state that
declares no `responsibleFormula`/`assigneeFormula` leaves the corresponding pair empty. This makes
the two consequences explicit:

- **Prior individual is always cleared on hand-off.** `in-progress` (`assignee = person:alice`)
  → `return-to-backlog` (a non-final `backlog` with `responsibleFormula` and *no* `assigneeFormula`)
  clears `assignee`, so alice is no longer the individual on a document she returned. Without
  clear-then-stamp the stale individual would linger on the unclaimed board.
- **The pool "survives pickup" because the assigned state re-declares it, not by preservation.**
  `backlog → in-progress` re-stamps `responsible = group:triage` only because `in-progress` itself
  carries `responsibleFormula`. A state that declares no responsibility genuinely has none.

**Per-state vs. sticky individual (a deliberate default).** Clear-then-stamp makes the individual
*per-state* by default: `assignee` does not follow a document from state to state unless each state
re-declares it. The legacy AWFBase engine chose the opposite — its `ResourceAssigned` is **sticky**
(`If ResourceAssigned = "" Then assignFromPool`), so once drawn from the pool the individual
persists through the whole lifecycle. We keep per-state as the default (it preserves the single
clear-then-stamp rule with no special-case preservation branch), and make the **sticky /
carry-forward** behaviour an explicit per-state authoring choice: a downstream state declares
`assigneeFormula: "doc.assignee"` to re-stamp the current individual. This is sound because
formulas resolve against the **pre-transition** envelope (ADR-0018 §3 — the server resolves before
`applyTransition` mutates), so `doc.assignee` reads the individual as they were on entry. Stickiness
is thus expressible but visible in the definition, never a hidden engine behaviour.

Entry to a **final** state clears both (nothing is owed on a done document — the ADR-0018 rule,
extended to the individual field), which is what keeps `/api/work-queue` and the inbox views free
of completed work without a final-state filter (§5, ADR-0022 §3). When a target state sets
`requireAssignee` (§2) and no `assignee` resolves, the transition is rejected **before** any stamp
is written — the document stays where it was.

### 4. Individual pickup ("claim") is a transition — engine-assign and self-claim are one mechanism

There is **no claim operation**. Picking up work is a transition into an assigned state whose
`assigneeFormula` resolves to the actor; assigning-by-engine is the same transition whose formula
is a lookup. The only difference is the formula:

```jsonc
// self-claim: the actor becomes the individual
{ "name": "in-progress", "responsibleFormula": "\"group:triage\"", "assigneeFormula": "user" }
// engine-assign (preferred default): a rule/lookup picks the individual
{ "name": "in-progress", "responsibleFormula": "\"group:triage\"", "assigneeFormula": "payload.approver" }

// the pickup transition — gated by pool membership via the EXISTING guard machinery
{ "id": "claim", "from": "backlog", "to": "in-progress", "requiredRole": "group:triage" }
```

A triage member fires `claim` → `applyTransition` stamps `assignee = <actor|lookup>` and keeps
`responsible = group:triage`; the pool survives, teammates still see it via `responsible in @me`,
and it is all one writer gated by the existing `requiredRole`. **Engine-assignment is the primary
model** (`assigneeFormula` is a lookup by default); self-claim is just the case where the formula
is `user`. "Claim" is app-authored workflow vocabulary (a transition id), exactly like the
agent-session `claim` transition (ADR-0021/0022) — no naming collision, because there is no new
engine concept named claim.

**Gating a pickup — static vs dynamic pool.** When the pool is a fixed principal, a static
`requiredRole: "group:triage"` correctly means "a member may pick up." When `responsibleFormula`
chooses the pool *per document* (a dynamic pool), a static `requiredRole` no longer means "member
of *this document's* current pool" — so gate the pickup with a guard over the already-stamped
`responsible` set, `doc.responsible.some(r => principals.includes(r))` (`responsible` is an array,
§1), mirroring ADR-0019's per-document authority pattern (`principals.includes(payload.approver)`
over a server-stamped field). The guard receives
the actor's `principals` identically client and server (invariant: workflow gating parity), so
offering and enforcement never diverge.

### 5. Listing — from a person's point of view (reuses ADR-0020 `@me`)

`@me` is field-agnostic, so all cases work with no DSL change:

| View | Filter | Meaning |
|---|---|---|
| My team's queue (all) | `responsible in @me` | pool inbox, assigned or not; teammates keep seeing assigned items (shared responsibility) |
| My work (individual) | `assignee in @me` | items where **I** am the individual |
| Unclaimed pool | `state == "backlog"` **AND** `responsible in @me` | up-for-grabs — expressed by state, since pickup is a transition |

"Everything I should act on" (`responsible in @me` **OR** `assignee in @me`) is two views (or a
future view-level OR) — an accepted cost. Because pickup is a *state change*, "unclaimed" is a
**state filter**, so the `op: "absent"` primitive the earlier draft needed is **no longer
required** for this design (kept only as an optional convenience if a single state ever holds
both assigned and unassigned documents — deferred to Follow-Ups).

Cross-app `/api/work-queue` (ADR-0022) matches the caller against **`responsible` OR `assignee`**
(team pool plus individual work). This is **not** a Mango `$or`: ADR-0022's posture (invariant
"Index & query") is to bind the `m2-readers` ACL index and apply routing/`kind` as **in-memory
predicates** over the ACL-scoped scan. The union is therefore a boolean OR *inside that in-memory
filter* — `principalsFor(caller)` intersects `responsible` **or** equals `assignee` — with:

- **Neither routing field may appear in the Mango selector.** The selector binds **only**
  `m2-readers` (the ACL/readers predicate) **plus `kind`**; *both* `responsible` and `assignee` are
  filtered in JS. If `responsible` (or `assignee`) leaked into the Mango selector, that half would
  be filtered server-side and the *other* half of the OR would be silently dropped — a document
  matching only `assignee` would never be returned. This is the one selector-shape rule that makes
  the in-memory OR correct.
- **no new index and no `$or`** — same index binding, asserted by the existing `_explain` e2e;
- **no second query and no dedup problem** — one scan visits each `_id` once, so a document where
  the caller is in *both* fields (a triage member individually assigned) is returned exactly once;
- **both timestamps on the row** — work-queue items carry `responsibleAt` and `assignedAt` so
  consumers can sort by standing age vs. individual-assignment age intentionally.

**Required e2e (finding coverage):** a document where the caller matches **only `assignee`** (not
in any `responsible` element) still appears in the work-queue — the test that fails if a routing
field ever leaks into the Mango selector.

It keeps returning only live work because `applyTransition` clears both pairs on final states.

### 6. What this deliberately does NOT do

- It does **not** make assignment enforcement (ADR-0018/0024 line). Teammates can action a pooled
  item because `requiredRole`/`canEditDocument` admit the group — never because of
  `responsible`/`assignee`. "Assigned to one person, others can also action" is satisfied by
  enforcement already; this ADR adds only the routing/visibility half.
- It does **not** introduce a second writer of any envelope field — pickup is a transition, so
  `applyTransition` remains the single writer of both pairs.
- It does **not** make routing failure fail a transition — *except* the one opt-in
  `requireAssignee` case (§2/§3), where a state whose purpose is to land on a person rejects entry
  rather than strand the document unassigned. Default stays fail-open.
- It does **not** provide **built-in load-balanced pool assignment.** The legacy AWFBase engine
  picked the *least-loaded* pool member (`AssignFromPool` scanned each member's open-job count and
  returned the smallest). Our `assigneeFormula` resolves in the async lane against the local
  replica, which cannot cheaply count open work across documents, so "assign to whoever is least
  busy" is **not** a first-class engine feature in v1. It is expressible where a maintained count
  exists (an `assigneeFormula` lookup over a stamped/aggregated field) or via a server effect/agent
  handler that assigns after the write — a conscious omission, not an oversight (Follow-Ups).
- It does **not** model **observers / followers.** Legacy AWFBase had a first-class Observer
  signal (`$AWFObserver`, observer jobs — people who watch a document without being responsible).
  ADR-0025 handles `responsible` and `assignee` only; a watch/follow-up work signal is **explicitly
  out of scope for v1** (not folded into responsibility) and is a candidate future concept if agent
  task-discovery ever needs "watching" work. Read-only visibility today is `aclRole:"reader"`.
- It does **not** add per-*transition* assignment (assignment is a property of the target state,
  per ADR-0018) — a transition-level override remains a future extension if ever needed.

## The line this ADR holds

**`responsible` is the standing responsibility — a *set* of accountable parties (pools/teams/
people); `assignee` is the single individual currently on it; neither is enforcement, and both are
engine-stamped by `applyTransition` from per-state formulas.** Shared responsibility is the default
(the responsible set survives an individual assignment), assignment routing has exactly one writer,
and "who may act" stays entirely in `requiredRole`/`canEditDocument` (ADR-0018/0024).

## Alternatives Considered

1. **A dedicated in-place `claim`/`release` engine op** (assignee changes with *no* state change)
   — rejected: it is the only shape that forces a **second writer** of an envelope field, the
   very weakening this design avoids. Modelling pickup as a transition (§4) covers the real need
   with the existing single writer and existing guards. This was an earlier draft's main
   decision; dropped once claim-as-transition was accepted.
2. **Keep the shipped `assignee` name for the pool; add a third name (`claimant`) for the
   individual** — rejected **because back-compat is not required**: its only merit was avoiding a
   rename of ADR-0020/0022's `assignee` references, which evaporates when we can reseed and
   re-baseline; it permanently entrenches ADR-0018's state(`responsible`)→envelope(`assignee`)
   discontinuity. The rename fixes it for the same expressive power.
3. **Repurpose `assignee` to person-only and add `responsible` (pool)** *without* the symmetric
   `assigneeFormula` — the original sketch; rejected: it breaks ADR-0020 `my-approvals`
   (group-valued `assignee` fan-out lands in `responsible`, so `assignee in @me` goes empty for
   everyone) and inverts ADR-0022 `/api/work-queue` (unclaimed team backlog reports `total: 0`,
   starving the operator spawn gate). This ADR takes the rename but *also* moves those consumers
   to `responsible`, so the standing signal follows the field.
4. **Per-transition assignment** (stamp the individual on the transition, not the target state) —
   deferred: ADR-0018 consciously made assignment a state property (its Alternative 2); finer
   per-transition control can be a future ADR if a real need appears.
5. **`op: "absent"` for the unclaimed board** — no longer part of this design (unclaimed is a
   state filter, §5); retained only as an optional deferred convenience.

## Consequences

- Positive: envelope names match the concepts and the ADR-0018 definition; the pool always
  survives an individual assignment (shared responsibility by default); engine-assign is the
  primary path with self-claim as a formula special case; **single-writer is preserved and
  strengthened** (both fields, one writer, no new op, no invariant weakening).
- Positive: a **faithful `$AWFSorumlu` successor** — multi-valued standing responsibility
  (`responsible: string[]`) plus a single individual (`assignee`), the exact
  `Responsibles`/`ResourceAssigned` split of legacy AWFBase, so heterogeneous pools and parallel
  teams are expressible without synthetic groups.
- Positive: the design reuses existing machinery end-to-end — async-lane resolution + approver
  normalization (ADR-0014/0017/0018), transition guards/`requiredRole` (ADR-0019), `@me`
  (ADR-0020). The net new surface is one optional state field pair (`assignee`/`assigneeFormula`
  +`requireAssignee`) and the renamed+widened `responsible` envelope pair.
- Negative: a **clean-break rename *and type widening*** of an engine envelope field
  (`assignee: string` → `responsible: string[]`) touching the engine, list selectors,
  `/api/work-queue`, the operator loop, shipped templates, and the text of ADR-0018/0020/0022 —
  permissible only because no back-compat is required (reseed, no backfill).
- Negative: the array `responsible` costs care at three seams (`@me` element-membership `$in`, the
  single `responsibleAt` for a set, set-vs-set work-queue intersection), all §1; `assignee` stays
  scalar so the individual paths are unaffected.
- Negative: the full personal inbox (`responsible OR assignee`) needs two views under the current
  filter grammar (no OR); deferred.
- Neutral: **no new Mango index** — `assignee` and `responsible` are in-memory predicates on
  already ACL-scoped rows (the ADR-0020/0022 cost class); the array `responsible` `$in` remains an
  in-memory predicate over the same scan, binding where scalar `assignee` did. Three-site
  index-sync rule untouched.

## Migration sequencing

Clean break, no backfill: dev/e2e reseed via `/api/reset` + the seed scripts (ADR-0024
precedent). Tier-3 substrate (workflow envelope rename + definition-contract addition) — run the
detective-layer multi-lens review (`.claude/workflows/review-change.js`) on the engine stage.

1. **Rename `assignee`→`responsible` *and widen it to `string[]`* (envelope + engine + consumers),
   one change.** Rename the `BusinessDocument` pair and `TransitionEvent.assignee`→`responsible`,
   typed as an array; update `applyTransition` (resolve `responsibleFormula` to a normalized
   principal *array*, stamp/clear `responsible`), the ADR-0020 `@me` templates (`my-approvals`
   etc. → `responsible in @me`, now element-membership `$in`), the `/api/work-queue` selector, and
   the operator loop. Reseed. Re-baseline ADR-0018/0020/0022 text and `docs/invariants.md`. Unit:
   a heterogeneous set (`["group:triage","person:supervisor"]`) fans out to every member via `@me`;
   empty resolution stores field-absent (not `[]`); `_explain` confirms the array `$in` still binds
   the existing index (in-memory predicate, no new index).
2. **Add `WorkflowState.assignee`/`assigneeFormula`/`requireAssignee` + `assignee` envelope
   stamping.** Extend the definition type + shared workflow validation (principal-shape for static;
   non-empty + `formulaBlockedToken` + compile for the formula — the `responsibleFormula` checks,
   mirrored; `requireAssignee` boolean **rejected on final states and on states declaring neither
   `assignee` nor `assigneeFormula`**), the MCP `update_state` patch (ADR-0018 §6 precedent), and
   `applyTransition` to **clear both pairs, then stamp** target-state values (§3), rejecting entry
   when `requireAssignee` and no `assignee` resolves. Unit: engine-assign (lookup) and self-claim
   (`user`) stamp the individual; fail-open resolution failure stamps nothing but succeeds;
   `requireAssignee` + empty resolution (including a `group:*`-only resolution) rejects the
   transition with no partial stamp; non-person/`group:*` normalizes away from `assignee`; a
   non-final entry with no `assigneeFormula` clears a prior individual; final states clear both;
   **carry-forward both fields — `responsibleFormula: "doc.responsible"` and
   `assigneeFormula: "doc.assignee"` re-stamp the pre-transition values** (proving formulas resolve
   against the pre-mutation envelope: all formulas are pre-resolved up-front and passed in, so
   clear-then-stamp cannot race them). Extend `/api/work-queue` to the in-memory
   `responsible ∪ assignee` union — selector binds `m2-readers`+`kind` only, both routing fields in
   JS, `_explain` still binding `m2-readers`, plus the e2e where a doc matches **only `assignee`**.
3. **Templates + `@me` worklists.** A triage/backlog scenario with `backlog → in-progress`
   (`claim`, `requiredRole` the pool) and the three worklist views (§5). E2E over the scenario.
4. **Client display + MCP (non-blocking).** Render `responsible`/`assignee` read-only where
   assignment renders; confirm the `update_state` designer surface validates the new fields.

## Follow-Ups

- [ ] **Invariant re-baseline (blocking, stage 1/2).** Replace the current invariant rule
      (`assignee`/`assignedAt` stamped only by `applyTransition`) with: **both** `responsible`
      (a `string[]` set) /`responsibleAt` (from `responsible`/`responsibleFormula`) **and**
      `assignee` (a single `person:*`) /`assignedAt` (from `assignee`/`assigneeFormula`) are
      engine-allocated, stamped only by `applyTransition` via **clear-then-stamp on every entry**,
      cleared on final states, routing-only — with the single fail-closed exception that a
      `requireAssignee` state rejects entry when no `assignee` resolves. Add a guard test asserting
      no other code path writes either pair. **Confirmed by owner; applied when stage 1/2 code
      lands (not before — the current rule still describes shipped behaviour until then).**
- [x] **Formula name** (§2): **`assigneeFormula`** (mirrors the `assignee` field, parallel to
      `responsibleFormula`) — confirmed.
- [x] **`/api/work-queue` union** (§5): **`responsible ∪ assignee`** — confirmed; realized as an
      in-memory OR over the `m2-readers`-bound scan (no `$or`, no new index, single-scan dedup).
- [ ] **Full personal-inbox OR** (§5): a view-level OR so `responsible in @me OR assignee in @me`
      is one view rather than two; deferred.
- [ ] **`op: "absent"`** (§5): add only if a single state must hold both assigned and unassigned
      documents; otherwise unclaimed stays a state filter.
- [ ] **Load-balanced pool assignment** (§6): a future capability — either a
      least-loaded `assigneeFormula` helper over a maintained open-work count, or a server
      effect/agent handler that assigns after the write. Legacy AWFBase (`AssignFromPool`) had this
      built in; v1 deliberately omits it.
- [ ] **Sticky-individual ergonomics** (§3): if `assigneeFormula: "doc.assignee"` carry-forward
      proves common, consider a `stickyAssignee` state shorthand — deferred until the pattern
      recurs.
- [ ] **Per-transition assignment override** (Alternatives 4): a future ADR if per-transition
      (not per-state) individual assignment is ever needed.
