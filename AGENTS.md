# Agent Instructions

This repository uses an explicit coding-agent workflow (template
`04-agent-workflow-system`). Beads/bv issue-tracking instructions are preserved at the
bottom of this file.

## Default Task Flow

For non-trivial bug fixes, features, refactors, and architecture changes:

1. Classify the task with `docs/taxonomy.md`.
2. Check Doc Sync Metadata using `docs/doc-sync.md`.
3. Inspect relevant docs, decisions, source, and tests based on that classification.
4. Identify blockers and prerequisites upfront.
5. Propose default decisions or recommendations.
6. Wait for confirmation if the user requested planning/confirmation.
7. Implement end-to-end after approval.
8. Verify with appropriate tests.
9. Update docs when architecture, APIs, invariants, taxonomy, testing strategy, doc sync metadata, or reusable patterns change.

Run `/preflight <task>` to produce a classified task brief before implementing.

## Required Context Sources

- `docs/agent-workflow.md`
- `docs/taxonomy.md`
- `docs/doc-sync.md`
- relevant files under `docs/context/`
- `docs/invariants.md`
- relevant ADRs under `docs/decisions/`
- `docs/testing-guide.md`
- nearby source files and existing tests

## Implementation Rules

- Prefer existing patterns over new abstractions.
- Keep changes scoped to the task.
- Surface hard blockers immediately.
- Use taxonomy classification to choose context, ADRs, test routes, and docs to update.
- Use doc sync metadata to detect stale docs before relying on them.
- Add or update tests for behavior changes.
- Do not bypass documented invariants.
- If docs and code conflict, inspect code and tests, then flag the discrepancy.

## Template Updates

- Read `docs/template-sync.md` before applying upstream template changes.
- Treat template drift separately from doc/code drift.
- Never overwrite project-owned files automatically.
- Use ownership metadata in `docs/template-sync.yml` to decide whether a file is template, hybrid, or project-owned.

## Project: Lotus Notes (M2 metadata runtime)

Metadata-driven, **offline-first** replicated app (CouchDB + React + Express). Form/view
**definitions are data** (`form:*`/`view:*` documents) that replicate to clients and drive
the runtime. Design: `docs/vision`, `docs/M2`.

### Layering (do not cross)

- `src/shared/**` — pure, portable; imported by BOTH client and server. No DOM, no Node/server-only APIs.
- `src/server/**` — Express + CouchDB. May import `shared`.
- `src/client/**` — React. May import `shared`. NEVER imports `server`.

### Aspects & invariants

The codebase has path-tagged invariants in `docs/invariants.md` (definitions contract,
validation parity, expression runtime, replication/conflict, ACL, offline, index/query,
docs sync). When you edit a tagged path the invariant hook surfaces the rule — confirm it;
do not skip a rule because the change "looks inert". Risk classes map to these aspects in
`docs/taxonomy.md`.

### Two review layers

- **Preventive (default, cheap):** `/preflight` + the invariant and doc-sync hooks. Use on every change.
- **Detective (reserved, expensive):** the multi-lens review workflow for Tier-3 substrate
  changes (replication, ACL, contract, index seeding) and milestones:
  `Workflow { scriptPath: ".claude/workflows/review-change.js", args: { mode: "diff", range: "<base>..HEAD" } }`
  Lens prompts: `docs/review-lenses.md`.

### Commands / environment

- `npm run build` — typecheck (`tsc --noEmit`) + build.
- `npm run test:e2e` — Playwright; needs the CouchDB pair up (see `tests/e2e/README.md`).
- Do NOT run `tsx watch` / Vite watch here — file watchers exhaust the host `fs.inotify` limit
  (`EMFILE`). Use `npm run test:serve` (non-watch).
- The two Mango indexes are defined in THREE places (`scripts/seed.ts`, `scripts/reset.ts`,
  `seedTarget` in `src/server/index.ts`) — keep them in sync.
<!-- br-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`/`bd`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

### Essential Commands

```bash
# View ready issues (open, unblocked, not deferred)
br ready              # or: bd ready

# List and search
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br search "keyword"   # Full-text search

# Create and update
br create --title="..." --description="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason="Completed"
br close <id1> <id2>  # Close multiple issues at once

# Sync with git
br sync --flush-only  # Export DB to JSONL
br sync --status      # Check sync status
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Always run `br sync --flush-only` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only open, unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads changes to JSONL
git commit -m "..."     # Commit everything
git push                # Push to remote
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always sync before ending session

<!-- end-br-agent-instructions -->

<!-- bv-agent-instructions-v2 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking and [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) (`bv`) for graph-aware triage. Issues are stored in `.beads/` and tracked in git.

### Using bv as an AI sidecar

bv is a graph-aware triage engine for Beads projects (.beads/beads.jsonl). Instead of parsing JSONL or hallucinating graph traversal, use robot flags for deterministic, dependency-aware outputs with precomputed metrics (PageRank, betweenness, critical path, cycles, HITS, eigenvector, k-core).

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). `br` handles creating, modifying, and closing beads.

**CRITICAL: Use ONLY --robot-* flags. Bare bv launches an interactive TUI that blocks your session.**

#### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns everything you need in one call:
- `quick_ref`: at-a-glance counts + top 3 picks
- `recommendations`: ranked actionable items with scores, reasons, unblock info
- `quick_wins`: low-effort high-impact items
- `blockers_to_clear`: items that unblock the most downstream work
- `project_health`: status/type/priority distributions, graph metrics
- `commands`: copy-paste shell commands for next steps

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command

# Token-optimized output (TOON) for lower LLM context usage:
bv --robot-triage --format toon
```

Before claiming, verify current state with `br show <id> --json` or `br ready --json`. `recommendations` can include graph-important blocked or assigned work; only `quick_ref.top_picks` and non-empty `claim_command` fields represent claimable work.

#### Other bv Commands

| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with unblocks lists |
| `--robot-priority` | Priority misalignment detection with confidence |
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles, k-core |
| `--robot-alerts` | Stale issues, blocking cascades, priority mismatches |
| `--robot-suggest` | Hygiene: duplicates, missing deps, label suggestions, cycle breaks |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues |
| `--robot-graph [--graph-format=json\|dot\|mermaid]` | Dependency graph export |

#### Scoping & Filtering

```bash
bv --robot-plan --label backend              # Scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # Historical point-in-time
bv --recipe actionable --robot-plan          # Pre-filter: ready to work (no blockers)
bv --recipe high-impact --robot-triage       # Pre-filter: top PageRank scores
```

### br Commands for Issue Management

```bash
br ready              # Show issues ready to work (no blockers)
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br create --title="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason="Completed"
br close <id1> <id2>  # Close multiple issues at once
br sync --flush-only  # Export DB to JSONL
```

### Workflow Pattern

1. **Triage**: Run `bv --robot-triage` to find the highest-impact actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Always run `br sync --flush-only` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads changes to JSONL
git commit -m "..."     # Commit everything
git push                # Push to remote
```

<!-- end-bv-agent-instructions -->
