# ADR-0019: Field computation modes (Notes-style) and guard-gated dynamic approvers

Date: 2026-07-02

## Status

Proposed — design agreed with the product owner in review of the shipped ADR-0017 gate;
**supersedes ADR-0017's transition gate** (ADR-0018's assignee machinery survives and is
fed from the new approver field). Tier-3 substrate change; multi-lens `review-change` on
this plan before building. Nothing is deployed or pushed, so the supersession is a clean
removal, not a deprecation.

## Context

ADR-0017 enforced "the requester's department head approves" with a transition-level
`approverFormula` resolved server-side at gate time. It works (proven in the airline
scenario), but it bought freshness at the cost of parity: the client cannot resolve async
formulas, so formula-gated actions are offered advisorily and refused with a 422 — the
first deliberate client-offers/server-rejects divergence in the platform, requiring a
carve-out in the validation-parity invariant.

The product owner chose the opposite trade: **store the approver on the document and gate
with an ordinary guard.** Guards run in the sync lane identically on both tiers, so the
approve button appears exactly for whoever can act — parity restored, engine simplified.
What that requires is the primitive the platform was missing: a field whose value is
*computed with lookups and stored*. Generalizing, the field model becomes Lotus Notes'
computation-mode family — which also un-conflates a long-standing wart where "formula"
was a *datatype* (`type: "formula"`), losing the field's real type for columns,
validation, and rendering.

## Taxonomy

- Subsystem: Shared, Server, Client, MCP (schemas), Templates.
- Domain Area: Definitions-as-data (field + workflow contract), validation & expressions,
  access control.
- Change Type: Architecture change (supersedes part of ADR-0017).
- Risk Class: Contract / back-compat (pre-release, no live deployments), validation
  parity (restored), expression safety, ACL / readers.
- Runtime Surface: Internal API, Web UI, MCP.

## Decision

### 1. Field computation modes

`FormField` gains `mode` (with `formula` alongside); `type: "formula"` is **removed** —
fields always keep their real datatype:

```jsonc
{ "name": "approver", "type": "text", "label": "Approver",
  "mode": "computed",
  "formula": "await DbLookup('org', …) || 'group:managers'" }
```

| Lotus Notes | `mode` | Stored | Resolved | Client renders |
|---|---|---|---|---|
| Editable | *(absent)* | yes | user input | input |
| Computed | `computed` | yes | server, **every** payload write | read-only, from payload |
| Computed when composed | `computed-once` | yes | server, **iff absent** (create, or backfill for docs predating the field) | read-only, from payload |
| Computed for display | `computed-for-display` | no | server, per request (`/formulas`) | read-only, from `/formulas` |

- **Tamper rule (the security core)**: the server discards the client-supplied value for
  every non-editable mode on every write — `computed` re-resolves, `computed-once`
  preserves the existing value or first-resolves, `computed-for-display` never stores.
  Without this, a requester simply posts their own `approver` and self-approves.
  **This applies to every payload write path** — document POST, document PUT, **and the
  conflict-resolve route** (review blocker B1: resolve writes an elected payload and
  would otherwise smuggle a self-serving approver past the pipeline; it now runs
  normalize → compute handlers → stamp before its write. Its pre-existing lack of
  user-input validation on elected payloads is unchanged and out of scope here).
- **Resolution context**: async lane (`@DbLookup`/`@DbColumn`), under the **writer's**
  ACL scope, against the **local replica**. **Preserve-on-empty** (review M1/m5): when a
  `computed` re-resolution yields nothing — ACL-blind writer, unreachable source app,
  transient failure — the previously stamped value is **preserved**, never cleared and
  never replaced by a broad fallback; degradation must not widen authority. Formulas are
  therefore written to *distinguish* "cannot see the source" (return `undefined` →
  preserve) from "source says none" (return the intended fallback, e.g. a genuinely
  headless department → `'group:managers'`). Stamped results are coerced to the field's
  datatype; non-primitive results are treated as empty (review m7).
- **Write order** (review M2): `normalizePayload` (strips `computed-for-display`, skips
  defaults for non-editable modes) → `applyComputedFields` (M7 pure handlers) →
  `validatePayload` (user-editable fields only) → **build/merge the document envelope**
  → **stamp computed modes with `doc` bound to that envelope** (`createdBy` is the
  requester on POST and the preserved creator on PUT — binding the acting writer would
  re-route approval to the editor) → write. Stamping after validation means cross-field
  `validate` rules see the *previous* stamped value — documented, not accidental
  (review m6).
- **Conflict resolution runs the stamp pipeline** (review B1 superseded the earlier
  "writes as-is" posture): the elected payload passes normalize → compute handlers →
  stamp before the write, under the resolver's scope with preserve-on-empty — so an
  elected revision cannot carry a tampered computed value, while `computed-once` values
  are preserved from the chosen revision as usual.
- **`computed-once` empty-at-compose**: an empty resolution is retried at the next save
  (resolve-iff-absent), a deliberate self-healing softening of Notes' strict
  compose-time freeze.
- **Readability precondition** (review M1): a gated docType's approver formula source
  (the org app) must be readable by the population that *writes* gated documents;
  deployments grant it as the airline fixture does. A writer outside that population
  degrades per preserve-on-empty (edits keep the prior approver; a brand-new document
  stamps nothing and the submit guard blocks — fail closed, never fail broad).
- **Unbounded-formula exposure** (review m3): moving the async lane onto the save path
  extends ADR-0014's known no-execution-deadline limitation to document writes; accepted
  as the same designer-trust boundary (formulas are designer-authored data), with the
  deadline follow-up remaining open and now higher priority.
- **Pre-existing documents** (review m9): documents created before a computed field was
  added carry no stamp until their next save (approve guards refuse until then);
  re-saving is the unstick path. Pre-release, every environment is reset/reseeded when
  this lands (review m1) — additionally, definition validation explicitly **rejects**
  the superseded `approverFormula` key so stale ADR-0017-era workflow definitions fail
  loudly at their next designer save instead of silently losing their gate.
- **Approver-readability constraint** (review m2): the stamped approver must be able to
  *read* the document to act on it — satisfied when the approver shares the requester's
  department group or sits in the form's `defaultReaders` (both true in the template);
  documented as a template-design constraint rather than auto-widening `readers`.
- **Validation**: computed modes require `formula` (blocked-token + syntax checked);
  editable mode forbids it; computed modes reject `required`/`defaultValue`/`validate`/
  `compute` (the server owns the value; user-input rules and the sync handler conflict).
- **M7 `compute` handlers are untouched**: they are the *parity-lane* computed variant —
  manifest-declared pure code running identically on client and server (e.g. expense
  `gross`), which formulas cannot be (async, server-only). Consolidation deferred.

### 2. Guards gain `principals`

`principals` is populated only for workflow guard evaluation; other sync-lane contexts
(visibility, validation rules) compile with an empty array — referencing it there is
legal but always-empty by design (review m8).

`ExpressionContext` gains `principals?: string[]` (the actor's person + group ids), and
the workflow engine threads the principals it already receives into guard evaluation.
Guards can now express membership: `principals.includes(payload.approver)`. The sync
lane's parity is preserved — the client knows the session's principals, so offering and
enforcement agree exactly.

### 3. Guard-gated approvers (supersedes ADR-0017's gate)

- The leave-request form gains `approver` (`text`, `computed`): the requester's
  department head, parent-walk when the requester is the head, terminal fallback
  `'group:managers'` — resolved and stamped at every save.
- Transitions gate with ordinary guards: `submit` requires `!!payload.approver`
  (belt-and-braces); `approve`/`reject` require `principals.includes(payload.approver)`
  and **drop `requiredRole`** (keeping it would AND the gates and re-block a head who
  isn't in `group:managers`).
- `approverFormula` is removed from the engine, route, validation, and MCP; the
  advisory-offering rule reverts (offering is role/guard-based and exact again); the
  validation-parity invariant carve-out is reverted.
- ADR-0018 is unchanged: `submitted.responsibleFormula` becomes `"payload.approver"`,
  so the assignee tracks the stamped approver.
- The leave-request form also gains `department` (`text`, `computed-once`) — the
  filed-under department, historically accurate across transfers, shown as a
  pending-approval view column, and the live exercise of the `computed-once` mode.

### The trade, stated plainly

**Stored enforcement is stable, not fresh.** The approver is fixed at the last payload
write; an org-chart change mid-approval does not re-route a submitted request (editing
re-stamps). ADR-0017 made the opposite choice (fresh but advisory-offered). The product
decision is that parity, simplicity, and Notes-idiomatic modelling outweigh the staleness
window; the window is documented and the re-stamp-on-save rule bounds it.

## Alternatives considered

1. **Keep ADR-0017's gate-time resolution** — rejected by the product owner for the
   parity divergence and the extra engine concept; superseded here.
2. **`stored: true | "once"` flag on `type: "formula"`** — subsumed: the mode model is
   the same mechanics with the datatype conflation fixed and the full Notes family.
3. **Manual approver selection** (editable field) — rejected: requester picks their own
   approver; also no cross-app select source exists.
4. **Effect/agent stamps the approver post-create** — rejected: best-effort and racy
   against an immediate submit.

## Consequences

- Positive: exact button offering (no 422-after-offer); computed fields keep datatypes
  (columns/sorting/validation work); the complete Notes field model; stored approver and
  department visible in views; simpler workflow engine (one gate mechanism: role +
  guard).
- Negative: the staleness window above; a second substrate pass over ground ADR-0017
  just covered (accepted — pre-release is the cheapest moment to fix the model).
- Neutral: `/formulas` shrinks to `computed-for-display`; the org template's `manager`
  migrates to `type: "text", mode: "computed-for-display"` with no behavior change.

## Acceptance sketch

- Unit: mode validation matrix (formula required/forbidden, rejected companions,
  unknown mode), editable-check by mode, guard `principals` membership, engine gate
  reverted to role+guard only.
- Server integration/e2e: tamper attempts on `approver` (computed) and `department`
  (computed-once) are discarded; `computed-once` survives an edit after the requester
  "transfers" while `computed` re-stamps; `/formulas` returns only computed-for-display
  fields.
- E2E (airline): the full ADR-0017 enforcement matrix re-proven under guards — carol
  approves dave, erin/grace 422 on dave, hank (head, no manager role) approves ivy,
  headless department falls back to `group:managers` via the formula fallback; the
  approve button is offered exactly to the stamped approver (parity); assignee stamping
  and clearing unchanged.
