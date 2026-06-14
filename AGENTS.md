# Agent Instructions

This repository uses an explicit coding-agent workflow.

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
