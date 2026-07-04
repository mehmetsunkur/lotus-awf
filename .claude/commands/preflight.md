---
description: Produce a task preflight brief (classify, gather context, surface blockers) before coding
argument-hint: "<task description>"
allowed-tools: Bash(node:*), Read, Grep, Glob
---

Current doc-sync state (so you can flag stale knowledge before trusting it):

!`node .claude/scripts/doc-sync-scan.mjs`

You are running the preflight step before implementing this task:

$ARGUMENTS

Produce a task brief in the shape of `docs/task-preflight-template.md`. Do NOT start
implementing — stop after the brief and wait for my approval. Work through:

1. **Classify** the task with `docs/taxonomy.md`: subsystem, domain area, change type,
   risk class, runtime surface, ownership boundary.
2. **Choose context from the classification**, then read it: the relevant context cards
   under `docs/context/`, applicable ADRs under `docs/decisions/` (if that directory
   exists), `docs/invariants.md`, and `docs/testing-guide.md`. Read the nearby source and
   existing tests too.
3. **Check doc-sync drift** using the report above: for any doc you intend to rely on whose
   watched paths show as STALE, reconcile it against the code (or treat it as suspect)
   before trusting it as authority.
4. **Existing patterns**: what nearby implementation should this follow?
5. **Applicable invariants**: which rules must this change preserve?
6. **Blockers / prerequisites**: what must be decided or available first? Recommend a
   default decision for each blocker.
7. **Plan**: an implementation breakdown, a test plan (unit / integration / e2e / manual),
   and the list of docs that will need updating when the change lands.

Keep it concise and concrete. Cite file paths. Surface hard blockers at the top.
