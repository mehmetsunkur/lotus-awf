# Lotus Notes — agent working agreement

Metadata-driven, **offline-first** replicated app (CouchDB + React + Express).
Form/view **definitions are data** (`form:*` / `view:*` documents) that replicate
to clients and drive the runtime. Design: `docs/vision`, `docs/M2`. Review system:
`docs/guardrails`.

## Layering (do not cross)
- `src/shared/**` — pure, portable; imported by **both** client and server. No DOM,
  no Node/server-only APIs.
- `src/server/**` — Express + CouchDB. May import `shared`.
- `src/client/**` — React. May import `shared`. **Never** imports `server`.

## Before finishing ANY change (and when writing a plan): aspect check
This codebase has 9 review **aspects** (`docs/guardrails/aspect-taxonomy.md`).
Name which aspects your change touches using the **blast-radius trigger table**,
and satisfy each touched aspect's questions in `docs/guardrails/lens-mandates.md`.

**Do not skip an aspect because the change "looks inert."** That judgment is the
exact blind spot this guards against — if a path is in a trigger row, walk that
aspect's questions and confirm (a clean pass is a fine answer; an unconsidered one
is not).

Quick map (authoritative table is in the taxonomy doc):

| If you touch… | Consider |
|---|---|
| `src/shared/validation.ts` | **A2** — enforce the rule on **both** client and API paths |
| `src/shared/expression.ts` | **A3** — eval safety + identical result client/server |
| `src/shared/types.ts` (`FormDefinition`/`ViewDefinition`) | **A1** — back-compat for already-replicated docs |
| `form:*`/`view:*` defs, `seed-data.ts` | **A1** + **A7** (+ **A5** if `readers`) |
| `/api/documents` save paths | **A2** + **A6** (must work offline) |
| view `sort`/`filter`, `mangoSelector` | **A7** — indexes live in **THREE** places (`scripts/seed.ts`, `scripts/reset.ts`, `seedTarget` in `src/server/index.ts`) — update all three |
| replication / `_rev` / `_conflicts` | **A4** |
| `readers`/`authors`, filtered replication | **A5** |
| any behavior/contract change | **A8** — update `docs/M*/0X-*` so the spec stays true |

## Tier-3 substrate changes
If a change touches replication (`src/server/couch.ts`), ACL, the definition
contract types, or index seeding, a miss is high-stakes and often irreversible
(data loss on sync, ACL leak, stranded replicated docs). For these — and at
milestone boundaries — consider the full multi-lens review before finishing:

```
Workflow { scriptPath: ".claude/workflows/review-change.js",
           args: { mode: "diff", range: "<base>..HEAD" } }
```

This is the **expensive** layer — reserve it for substrate/milestone, not routine
edits. Everything above (the aspect check) is the cheap default that should run on
every change.

## Commands / environment
- `npm run build` — typecheck (`tsc --noEmit`) + build.
- `npm run test:e2e` — Playwright; needs the CouchDB pair up (see `tests/e2e/README.md`).
- **Do not** run `tsx watch` or Vite watch mode here — file watchers exhaust the
  host's `fs.inotify` limit (`EMFILE`). Use `npm run test:serve` (non-watch).
- Commit messages end with the `Co-Authored-By` trailer; branch before committing
  on `main`.
