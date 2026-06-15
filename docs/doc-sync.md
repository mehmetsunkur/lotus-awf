# Documentation Sync

Use doc sync metadata during agent preflight to detect whether a project knowledge file may be stale
before relying on it.

## Metadata Block

Docs that describe code behavior should include:

```md
## Doc Sync Metadata

- Last code review baseline: `TBD`
- Last reviewed date: `YYYY-MM-DD`
- Code areas:
  - `path/to/code/**`
- Tests:
  - `path/to/tests/**`
- Config/runtime areas:
  - `path/to/config/**`
- Review trigger:
  - Update this doc when behavior, contracts, tests, or runtime assumptions for this area change.
```

## How To Check Drift

Use the baseline and watched paths to inspect only relevant changes:

```bash
git diff --name-only <baseline> -- <code-area> <test-area> <config-area>
git diff <baseline> -- <code-area> <test-area> <config-area>
```

If watched files changed, treat the doc as potentially stale and reconcile it with code before
using it as authority.

## Updating Metadata

- Keep `TBD` until the doc is first reviewed against real project code.
- After reconciling the doc with code, set the baseline to the commit used for the review.
- If the final commit does not exist yet, leave the previous baseline and update it in the docs sync follow-up.
- If watched paths are unknown, mark them `TBD` and infer them during the next task preflight.
