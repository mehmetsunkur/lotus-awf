# ADR-0024: Notes-style Readers/Authors flagged fields as the single ACL authoring mechanism

Date: 2026-08-07

## Status

Accepted. Implemented: two-layer `canEditDocument` (Layer 1 Editor+ ACL bypass, Layer 2
group/role-aware Authors intersection), the `aclRole` FormField axis with computed-only
validation, the `rollupAclProjection` server projection onto envelope `readers`/`authors`,
`defaultReaders` deleted from the type/validation/create path, and all shipped templates +
scenario builders migrated to `aclRole:"reader"` fields (verified via tsc + unit; e2e per the
test plan). The m2-readers index is untouched.

Supersedes ADR-0015's `defaultReaders` form policy (removed outright — no back-compat is
required, so there is no desugar shim; see Migration). Extends ADR-0019 (field computation
modes) with a third orthogonal field axis. Holds the
ADR-0018 line — workflow routing (`assignee`) still never confers access — by explicitly
rejecting workflow-state-driven authorship (see Alternatives 3).

## Context

The engine already owns two envelope ACL fields — `readers: string[]` and `authors: string[]`
(`src/shared/types.ts`) — stamped at document creation. But the *designer-facing* way to
populate them is thin and inconsistent with the Notes model this platform emulates:

- `readers` gets a static form policy, `FormDefinition.defaultReaders` (ADR-0015): principals
  always added beyond the creator (expense carries `["group:finance"]`).
- `authors` gets **nothing** — it is hardcoded to `[creator]` in `createDocument`
  (`src/server/seed-data.ts`) and never recomputed. There is no designer channel to make a
  document editable by anyone but its creator.
- `canEditDocument` (`src/shared/access.ts`) is **person-only** — a `group:*` in `authors` is
  inert (asserted by `tests/unit/access.spec.ts`), and it ignores `scope.accessLevel`, so an
  app-level Editor/Manager who did not author a document gets a 403 on `PUT`.

Real Lotus Notes had no `defaultReaders` concept. It had **one** mechanism: a field carried a
Readers or Authors *flag* (a field data type), and that field's value — static or computed —
*was* the ACL. The view indexer read a computed aggregate item (`$Readers`) rolled up from all
Readers-flagged fields; the editor log (`$UpdatedBy`) was a separate, unflagged item. Access
enforcement was two-layer: the database ACL level, then the Authors-field intersection, with
Editor+ bypassing the field entirely.

This repo copied the Notes ACL **level names** (`none|reader|author|editor|designer|manager`)
and the **field names** (`readers`/`authors`) but implemented neither the flagged-field
authoring mechanism nor the two-layer enforcement. `defaultReaders`/`defaultAuthors` are
bolt-ons compensating for the missing mechanism. Building the mechanism removes the need for
them.

## Taxonomy

- Subsystem: Shared, Server, Client (display only).
- Domain Area: Definitions-as-data (form contract + document envelope), Identity & ACL,
  Validation & expressions.
- Risk Class: Contract / back-compat (retires `defaultReaders`), Security (ACL / readers /
  authors), Expression safety (computed ACL fields).
- Runtime Surface: Internal API, Web UI, MCP (form designer surface).

## Decision

### 1. A third orthogonal field axis: `aclRole`

`FormField` gains one optional flag, orthogonal to `type` (datatype) and `mode` (ADR-0019
computation):

```jsonc
{ "name": "financeReviewers", "type": "text", "label": "Finance reviewers",
  "aclRole": "reader",             // this field's value contributes to document readers
  "mode": "computed-once", "formula": "[\"group:finance\"]" }   // constant list = trivial formula
{ "name": "owners", "type": "text", "label": "Owners",
  "aclRole": "author",             // ...contributes to document authors
  "mode": "computed", "formula": "..." }                        // re-rolled on every write
```

`aclRole?: "reader" | "author"` is the Notes Readers/Authors flag. Absent = an ordinary field
with no ACL effect.

**`aclRole` fields are computed-only** — a field carrying `aclRole` MUST declare
`mode: "computed"` or `mode: "computed-once"` and a `formula`; static/editable (`defaultValue`,
plain input) and `computed-for-display` are rejected by validation. `computed-once` is Notes
"Computed when composed" (stamp at create, never overwrite); `computed` is Notes "Computed"
(re-rolled on every write — the append-editors behavior). No expressiveness is lost: a "static"
ACL is just a `computed-once` field whose formula returns a constant list. The value therefore
always comes from the server-side ADR-0019 async-lane resolver, never from a client-editable
payload value — which is what makes §3 hold by construction rather than by extra validation.

### 2. Envelope `readers`/`authors` are retained as the server-materialized projection

The flagged fields are the **source of truth the designer edits**; the envelope arrays remain,
demoted from "designer-authored policy" to **engine-computed aggregate** — the `$Readers`
projection Notes itself maintained for its indexer. At every write, the compute pipeline
(`stampComputedFields`) materializes:

```
readers = principalsFor(creator) ∪ ⋃(values of every aclRole:"reader" field)
authors = [creator.person]        ∪ ⋃(values of every aclRole:"author" field)
```

The designer never sets envelope `readers`/`authors` directly. Because the projection lands on
the **same top-level `readers` field**, the `m2-readers` Mango index (`scripts/seed.ts:6`,
`scripts/reset.ts:6`, `src/server/index.ts:589`) binds unchanged — the invariant-120
three-place index rule is untouched, the coarse DB gate + `canReadDocument` fine-check model
(invariant 93) is intact, and audit's `readers`-copy (invariant 83) still narrows visibility.

### 3. ACL-flagged fields are server-owned (tamper)

An `aclRole` field controls access, so a client must never set it to hide a document
(`readers: []`) or self-grant authorship. Because §1 forces `aclRole` fields to be
**computed-only**, this holds by construction: the value is always server-resolved, and — like
every ADR-0019 computed field — a client/MCP-supplied value for it is discarded on every write
path. The resolver output is normalized principal-shaped (same posture as `responsibleFormula`,
ADR-0018) so a malformed formula can never stamp a non-principal into the projection. MCP
remains barred from mutating `readers`/`authors` (invariant 103), now also from setting
`aclRole` field values.

### 4. Creator is always included; readers stay an explicit allow-list

The creator's principal is always unioned into both projections (offline-first: you must be
able to read and edit what you just created). We **deliberately diverge from Notes' "empty
Readers field ⇒ visible to all ACL readers"** semantic and keep this repo's existing rule:
`readers` is an explicit allow-list you must be a member of. Rationale: the coarse Mango gate
(`readers ∈ principals`) depends on an explicit allow-list for selectivity; "absent ⇒
app-wide" would force the index to always match app scope and erase its selectivity. Because
the creator (and any static reader field) always populates `readers`, the "empty" case does not
arise in practice.

### 5. Two-layer enforcement restored (prerequisite, folded in)

An Authors-flagged field is meaningless under the current `canEditDocument`. This ADR makes
`canEditDocument` Notes-faithful — the data is already in scope (`requireAppSession` populates
`scope.accessLevel` on the `PUT`/`DELETE`/transition routes):

```ts
export function canEditDocument(doc, scope): boolean {
  if (hasAccessLevel(scope, "editor")) return true;                 // Layer 1: ACL Editor+ bypass
  return principalsFor(scope).some((p) => doc.authors.includes(p)); // Layer 2: group/role-aware Authors
}
```

This adds the **Editor+ ACL bypass** and makes the Authors check **group/role-aware**, matching
Notes. `tests/unit/access.spec.ts` (which asserts a group author cannot edit) is updated to the
new contract.

### 6. `authors` stays authorization, not audit

This ADR does not touch the editor log. `authors` is the Authors-field (authorization);
`updatedBy` + the CDC `auditevent` stream remain the `$UpdatedBy`-style record of who actually
saved. Enforcement, routing (`assignee`), and audit stay three separate concerns.

### 7. Remove `defaultReaders` outright

No back-compat is required, so `FormDefinition.defaultReaders` is **deleted** — from the type,
validation, and `readersForNewDocument` — in the same change that adds the rollup. There is no
desugar shim and no coexistence window: the rollup (§2) reads only `aclRole` fields from day
one. The one shipped template that used it (expense: `["group:finance"]`) is edited in the same
PR to carry an explicit `aclRole:"reader"`, `computed-once` field returning `["group:finance"]`.
Dev/e2e reseed via `/api/reset` + the seed scripts; there is no document backfill.

## Alternatives Considered

1. **Keep `defaultReaders` and add `defaultAuthors` + `authorsFormula`** — rejected: three
   overlapping concepts bolted onto envelope fields, none of them the Notes mechanism, and
   `authorsFormula` reinvents the ADR-0019 compute modes for the envelope. The flagged-field
   axis subsumes all three.
2. **Eliminate envelope `readers`/`authors`; compute access from flagged fields at query time**
   — rejected: destroys the `m2-readers` index binding and the coarse-gate performance model
   (every ACL-scoped query becomes a full scan). Notes avoided this with the `$Readers`
   aggregate; §2 is that aggregate.
3. **Workflow-state-driven authorship** (`WorkflowState.authors`/`authorsFormula` stamped by
   `applyTransition`) — rejected here: it crosses ADR-0018's load-bearing line ("assignee is
   routing truth, never enforcement truth"); a state-stamped `authors` goes stale when the org
   chart changes mid-flight, the exact failure ADR-0018 rejected. If ever needed it warrants its
   own ADR consciously overriding 0018, not a rider on this one.
4. **Adopt Notes' "empty Readers ⇒ ACL-wide" semantic** — rejected (§4): incompatible with the
   explicit-allow-list index gate; larger security surface for no template benefit.

## Consequences

- Positive: one Notes-faithful authoring mechanism for both read and edit access; designers set
  access with a computed field (constant-formula for a static list, `computed` for a live one),
  reusing ADR-0019 modes. `defaultReaders` retired; `defaultAuthors`/`authorsFormula` never
  needed.
- Positive: documents become editable by non-creators (group/role/team) declaratively —
  closing the "only the creator can edit" gap — and app-level Editor+ can finally edit as the
  ACL level implies.
- Positive: envelope projection keeps the index, coarse gate, and audit-copy semantics
  unchanged (three-place index rule untouched).
- Negative: **breaking definition-contract change, taken as a clean break** (no back-compat) —
  `aclRole` added to the form schema + validation + MCP designer (`update_field`-equivalent);
  `stampComputedFields` gains the ACL rollup; `defaultReaders` deleted outright and the expense
  template edited in the same change; `canEditDocument` semantics change (test updated; operator
  path verified unaffected — see Follow-Ups — with only a stale justifying comment to touch up).
  Any external form JSON carrying `defaultReaders` stops validating and must be hand-edited to
  an `aclRole` field — accepted, since nothing outside the repo depends on the old contract.
- Negative: `authors` becomes multi-writer over a document's life (computed re-roll), so an
  Authors-flagged `mode:"computed"` field is additive-only in practice (the current writer is
  already authorized to reach the write) — documented, not enforced by a new gate.

## Follow-Ups

- [x] Operator path verified safe: `src/operator/operator.ts` never calls `canEditDocument`
      (the reference at line 276 is a comment), builds no `PrincipalScope` of its own, and
      writes only via `this.client` — role-gated `transitionDocument` and operator-authored
      `createDocument`, never a `PUT` on another person's payload. The Editor+ bypass cannot
      over-grant through it. Residual: the comment at `operator.ts:273-277` justifies its
      "outcome facts in an operator-authored artifact" choice with "`canEditDocument` is
      authors-only" — the choice stands but that premise goes false under §5, so the comment
      needs a light touch-up (doc-only, no behavior change).
- [x] `aclRole` field constraint decided: **computed-only** (`computed`/`computed-once` + a
      `formula`; static/editable and `computed-for-display` rejected). Safer — the value is
      server-owned by construction (§1/§3); a constant-formula `computed-once` covers the
      "static list" case with no loss.
- [ ] `stampComputedFields` rollup ordering vs. computed payload fields — the ACL rollup is a
      post-pass: every `aclRole` field (itself computed) must resolve first, then the envelope
      `readers`/`authors` are materialized from their values ∪ creator.

## Migration sequencing

No back-compat, so no shim and no coexistence window — this collapses to three stages. Each
ACL-touching stage is Tier-3 substrate, so run the detective-layer review
(`.claude/workflows/review-change.js`) per stage. No document backfill: dev/e2e reseed via
`/api/reset` + the seed scripts, and the envelope `readers`/`authors` projection stays valid
regardless.

1. **Two-layer `canEditDocument` (isolated security change).** Add the Editor+ ACL bypass +
   group/role-aware Authors check (§5); update `tests/unit/access.spec.ts`. Independently
   correct (restores Notes two-layer) and ships alone — smallest diff, isolated ACL review. No
   schema change. Index untouched.
2. **Add `aclRole`, remove `defaultReaders`, migrate expense — one change.** Schema +
   validation (computed-only rule) + the `stampComputedFields` rollup post-pass (single source:
   `readers = creator ∪ ⋃(aclRole reader fields)`, likewise authors); **delete**
   `FormDefinition.defaultReaders` + its validation + the `readersForNewDocument` branch; edit
   the expense template to an explicit `aclRole:"reader"` computed-once field returning
   `["group:finance"]`. Reseed. Tests: rollup correctness + tamper (client-set `aclRole` values
   discarded) + expense readers unchanged after reseed. Index untouched. Re-baseline
   `docs/invariants.md`; set ADR-0015 Status to *Superseded by 0024*.
3. **Designer + client surface (non-blocking).** Add `aclRole` to the MCP field-designer patch
   (`update_field`-equivalent, validated) and render `aclRole` fields read-only in the web UI
   where computed fields render. Touch up the stale `operator.ts:273` comment here.

## Follow-Ups (post-migration)

- [ ] Invariants + doc-sync: add an ACL-rollup invariant (envelope readers/authors are
      server-materialized from computed `aclRole` fields; never client-set) and re-baseline
      `docs/invariants.md`; record the two-layer `canEditDocument` change and the retirement of
      `defaultReaders`.
