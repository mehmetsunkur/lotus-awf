# Invariants

## Doc Sync Metadata

- Last code review baseline: `TBD`
- Last reviewed date: `YYYY-MM-DD`
- Code areas:
  - `TBD`
- Tests:
  - `TBD`
- Review trigger:
  - Update this doc when a must-preserve rule is added, removed, broken, or clarified.

These are rules implementation must preserve. They are the authoring-time aspects of
this codebase: when an agent edits a tagged path, the invariant hook
(`.claude/hooks/invariants.mjs`) surfaces the matching rule(s). Do not skip a rule
because the change "looks inert" — confirm it. A clean pass is fine; an unconsidered
one is not.

The richer, adversarial review prompts derived from these rules live in
`docs/review-lenses.md` (used by the Tier-3 multi-lens review workflow).

## Path Tagging

Tag an invariant with the code paths it governs via a nested `- Paths:` bullet with one
or more globs. Until a rule has a `Paths:` tag the hook stays silent for it. Globs use
`**` (any depth) and `*` (within a path segment), matching `docs/doc-sync.md`.

```md
## Persistence

- Writes must go through the repository layer; no direct SQL in request handlers.
  - Paths: `src/db/**`, `src/repositories/**`
```

## Definitions-as-data contract & back-compat

- A change to a `form:*`/`view:*` definition or its TypeScript shape must preserve
  documents already created and replicated to clients. Provide a default or migration
  for old data; never make an existing field newly required without one.
  - Paths: `src/shared/types.ts`, `src/server/seed-data.ts`, `src/server/index.ts`

## Validation parity (client + API)

- Validation, required, visibility, and default rules must be enforced through
  `src/shared/validation.ts` on BOTH the client and the API save path — never inlined
  in only one. A payload the client accepts must not be rejected by the API, or vice
  versa.
  - Paths: `src/shared/validation.ts`, `src/server/index.ts`, `src/client/main.tsx`

## Expression runtime

- Expression evaluation must stay safe (no eval escape, host/global/prototype access,
  network, or unbounded loops), deterministic, and portable — identical result in the
  browser and on the server. A malformed or hostile expression must fail closed.
  - Paths: `src/shared/expression.ts`

## Replication & conflict

- Changes must preserve bidirectional replication and correct `_rev`/`_conflicts`
  handling. Never drop or silently lose a revision on resolve; a payload-shape change
  must not break how conflicting revisions are compared.
  - Paths: `src/server/couch.ts`, `src/server/index.ts`, `scripts/replicate.ts`, `scripts/force-conflict.ts`

## ACL / readers

- `readers`/`authors` must be set correctly on documents this code creates, and no row,
  field, or select-option may leak across users or roles. New query paths must still
  honour `readers` filtering.
  - Paths: `src/server/seed-data.ts`, `src/server/index.ts`, `scripts/acl-spike.ts`

## Offline editing

- Create/edit/validate/list/option-load must work against the LOCAL CouchDB with no
  server round-trip. Do not introduce a hard dependency on the server replica or network
  on an offline path; source select options and definitions from local data.
  - Paths: `src/client/main.tsx`, `src/server/index.ts`, `src/server/config.ts`

## Index & query

- A new view `sort`/`filter` field may require a Mango index. The two indexes
  (`m2-kind-docType-updatedAt`, `m2-readers`) are defined in THREE places —
  `scripts/seed.ts`, `scripts/reset.ts`, and `seedTarget` in `src/server/index.ts` —
  and must be kept in sync across all three.
  - Paths: `src/server/couch.ts`, `src/server/index.ts`, `scripts/seed.ts`, `scripts/reset.ts`

## Documentation & acceptance

- A behavior or contract change must update the spec of record (`docs/M*/0X-*`) and must
  not leave an acceptance criterion asserting something now false. (Path-level drift is
  also surfaced automatically by the doc-sync hook.)

## Testing

- Behavior changes require tests at the appropriate level (unit for `src/shared`,
  e2e for runtime flows under `tests/e2e/`).
