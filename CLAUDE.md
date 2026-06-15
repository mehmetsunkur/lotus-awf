# Claude Code Guidance

This project uses the Agent Workflow System template (`04-agent-workflow-system`). The
full agent contract — task flow, layering, aspects, commands — is in **`AGENTS.md`; read
it first.** This file adds Claude Code specifics.

## Workflow

Follow the task flow in `AGENTS.md`: classify with `docs/taxonomy.md`, check doc-sync
status, read the relevant context cards / ADRs / invariants / tests, surface blockers,
then implement and verify. Run `/preflight <task>` to produce the brief before coding.

## Claude Code automation

Two `PostToolUse` hooks fire on every `Edit`/`Write`, plus two commands:

- **Invariant hook** (`.claude/hooks/invariants.mjs`): surfaces the path-tagged invariants
  from `docs/invariants.md` that govern the file you just edited. Confirm each; do not skip
  one because the change "looks inert". Surface a needed break before continuing.
- **Doc-sync hook** (`.claude/hooks/doc-sync.mjs`): when you edit a path a knowledge doc
  watches (`docs/context/*`), names the docs to reconcile and re-baseline. A no-op is fine;
  an unreviewed drift is not.
- **`/preflight <task>`**: classified task brief (context, invariants, blockers, test plan).
- **`/doc-sync-check`**: reports which docs are stale against their baseline.

All read `docs/*.md` as data and stay silent while metadata is `TBD`.

## Detective layer (reserved)

For Tier-3 substrate changes (replication, ACL, definition contract, index seeding) and at
milestones, run the multi-lens review workflow — expensive, not for routine edits:

```
Workflow { scriptPath: ".claude/workflows/review-change.js",
           args: { mode: "diff", range: "<base>..HEAD" } }
```

Lens prompts live in `docs/review-lenses.md`.

## Environment notes

- `npm run test:e2e` needs the CouchDB pair up; use `npm run test:serve` (non-watch) — plain
  `npm run dev` exhausts the host `fs.inotify` limit (`EMFILE`).
- Commit messages end with the `Co-Authored-By` trailer; branch before committing on `main`.

## Updating this template

`.claude/` hook/scanner logic and `docs/doc-sync.md`/`docs/template-sync.*` are template-owned
(see `docs/template-sync.yml`). Put project knowledge in the docs the tools read
(`docs/invariants.md`, `docs/taxonomy.md`, `docs/context/*`) — not in the hook logic.
