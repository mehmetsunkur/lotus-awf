# Aspect taxonomy & blast-radius trigger table

The enumerated **aspects** of this codebase, and the table that routes a given
change to the aspects (lenses) it must be reviewed against. This is the keystone
artifact: context routing, per-aspect review, the plan checklist, and the
definition-of-done all key off the list below.

Keep it roughly MECE. When the system grows a genuinely new dimension, add an
aspect here first, then wire it into the trigger table.

---

## The aspects

### A1 — Definitions-as-data contract & back-compat
- **What:** the shape of `form:*` / `view:*` documents (`FormDefinition`,
  `ViewDefinition`, `FormField` in `src/shared/types.ts`) and the
  backward-compatibility of definitions **already replicated to clients**.
- **Why it drifts:** definitions are user-editable data, edited offline and
  replicated. A shape change can silently strand documents already on a client.
- **Source of truth:** `docs/M2/02-data-contract.md`, `src/shared/types.ts`.
- **Owning code:** `src/shared/types.ts`, `src/server/seed-data.ts`,
  `PUT /api/definitions/:id` in `src/server/index.ts`.

### A2 — Shared validation parity (client + API)
- **What:** the same validation runs in the browser and on the API save path —
  `validatePayload`, `applyFormDefaults`, `normalizePayload`,
  `isFieldRequired/Visible/ReadOnly`.
- **Why it drifts:** trivially easy to enforce a rule on one path only; client UX
  and server enforcement then diverge.
- **Source of truth:** `src/shared/validation.ts`.
- **Owning code:** `src/shared/validation.ts`; consumed by `src/client/main.tsx`
  and `POST`/`PUT /api/documents`.

### A3 — Expression runtime
- **What:** the portable evaluator for `visibleWhen` / `validate` / `expression`
  strings — `evaluateExpression`, `evaluateBoolean`.
- **Why it drifts:** expressions come from data; new syntax or capabilities can
  introduce unsafe evaluation or non-determinism, and must stay portable across
  client and server.
- **Source of truth:** `docs/M2/03-expression-runtime.md`,
  `src/shared/expression.ts`.

### A4 — Replication & conflict
- **What:** bidirectional sync (`replicateBidirectional`, `replicateOnce`),
  `_rev` / `_conflicts` handling, and the conflict inspect/resolve endpoints.
- **Why it drifts:** changes to document shape or save flow can break sync or
  produce conflicts the resolution UI cannot represent.
- **Source of truth:** `docs/M1/03-data-contract.md`,
  `docs/M2/02-data-contract.md`.
- **Owning code:** `src/server/couch.ts`, conflict handlers in
  `src/server/index.ts`, `scripts/replicate.ts`, `scripts/force-conflict.ts`.

### A5 — ACL / readers
- **What:** `readers` / `authors` on `BusinessDocument`, filtered replication, and
  `acl:*` rules.
- **Why it drifts:** a field or view change can expose data that the `readers`
  filter was meant to gate.
- **Source of truth:** `acl:rules` seed + `scripts/acl-spike.ts`.
- **Owning code:** `readers`/`authors` in `src/shared/types.ts`, view `filters`
  using `readers`, `src/server/seed-data.ts`.

### A6 — Offline editing
- **What:** local-first create/edit against the local CouchDB with **no server
  round-trip**, and online/offline status (`ReplicationStatus`, `ping`).
- **Why it drifts:** new save paths or option lookups can quietly introduce a hard
  server dependency, breaking the core M2 promise.
- **Source of truth:** `docs/M2/01-scope.md`.
- **Owning code:** save paths in `src/client/main.tsx` and `/api/documents`,
  `src/server/config.ts` (local vs server URLs), `GET /api/status`.

### A7 — Index & query
- **What:** Mango indexes (`m2-kind-docType-updatedAt`, `m2-readers`) and the
  view `sort`/`filters` → selector translation (`mangoSelector`, `use_index`,
  `findDocs`).
- **Why it drifts:** a new view `sort`/`filter` field may require a new index —
  and index definitions are currently **duplicated in three places**
  (`scripts/seed.ts`, `scripts/reset.ts`, and `seedTarget` in
  `src/server/index.ts`). Updating one and not the others is a live trap.
- **Source of truth:** `createIndex` in `src/server/couch.ts`.
- **Owning code:** the three seeding sites above, `GET /api/views/:id/documents`.

### A8 — Docs & acceptance sync
- **What:** `docs/M*/0X-*` is the spec of record; the acceptance criteria in
  `docs/M*/05-acceptance.md` must stay true.
- **Why it drifts:** behavior changes land in code while the spec quietly goes
  stale, so the spec stops being trustworthy.
- **Rule:** this aspect fires **whenever A1–A7 fire.** Treat the docs as stale
  until proven otherwise; name the doc/criterion a change falsified.

### A9 — Correctness (generic)
- **What:** plain logic bugs — the generalist pass. Always active.

---

## Blast-radius trigger table

Map the change signal (paths/symbols touched) to the aspects that must review it.
`A8` is implied wherever `A1–A7` appear. `A9` is always on.

| Change signal (path / symbol) | Activates |
|---|---|
| `src/shared/types.ts` — `FormDefinition` / `ViewDefinition` / `FormField` / `ViewFilter` | A1, A8 |
| `src/shared/types.ts` — `readers` / `authors` on `BusinessDocument` | A1, A5, A8 |
| `src/shared/validation.ts` | A2, A8 |
| `src/shared/expression.ts` | A3, A8 |
| `src/server/seed-data.ts` — `form:*` / `view:*` definitions | A1, A7, A8 |
| `src/server/seed-data.ts` — sample docs / `readers` | A1, A5, A8 |
| `src/server/index.ts` — `PUT /api/definitions/:id` | A1, A8 |
| `src/server/index.ts` — `POST`/`PUT`/`DELETE /api/documents` | A2, A6, A8 |
| `src/server/index.ts` — `/api/views/:id/documents`, `mangoSelector`, `use_index` | A7, A5, A8 |
| `src/server/index.ts` — conflict endpoints, `/api/demo/conflict` | A4, A8 |
| `src/server/couch.ts` — `replicateBidirectional` / `replicateOnce` | A4, A8 |
| `src/server/couch.ts` — `createIndex` / `findDocs` | A7, A8 |
| `scripts/seed.ts`, `scripts/reset.ts` — `createIndex(...)` | A7, A1, A8 |
| `scripts/replicate.ts`, `scripts/force-conflict.ts` | A4 |
| `scripts/acl-spike.ts` | A5 |
| `src/server/config.ts` — Couch URLs | A6, A4 |
| `src/client/main.tsx` — form rendering / save paths | A2, A6, A9 |
| `docs/M*/**` | A8 (reverse: a behavior change must land here too) |
| anything else | A9 |

---

## Routing tiers (cost vs. stakes)

Scale the fan-out to the blast radius — don't run nine reviewers on a typo.

| Tier | Trigger | Lenses run | Verify |
|---|---|---|---|
| **0 — trivial** | `src/client/styles.css`, `*.md`, comments only | A9 | no |
| **1 — UI / non-shared** | `src/client/main.tsx` and other client-only code | A9 + activated A2/A6 | majors only |
| **2 — shared / definitions / API** | anything under `src/shared/**`, definitions, `/api/*` | full activated panel | all findings |
| **3 — substrate** | `couch.ts` replication, contract types, ACL, index seeding | full panel + completeness critic | all + double-vote on blockers |

## Severity gating (definition-of-done)

| Severity | Action |
|---|---|
| `blocker` | must fix before "done" |
| `major` | fix, or waive with a written reason |
| `minor` / `note` | recorded, non-blocking |

A finding is not actionable until it survives **adversarial verification** (an
independent agent that tries to prove it is a non-issue). Unverified findings do
not gate.
