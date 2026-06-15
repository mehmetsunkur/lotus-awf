# Agent Workflow

## Doc Sync Metadata

- Last code review baseline: `TBD`
- Last reviewed date: `YYYY-MM-DD`
- Code areas:
  - `TBD`
- Tests:
  - `TBD`
- Config/runtime areas:
  - `TBD`
- Review trigger:
  - Update this doc when agent preflight, blocker handling, implementation flow, or documentation update rules change.

## Preflight

Before implementation, agents should produce a short task brief:

- task summary
- task classification from `docs/taxonomy.md`
- doc sync status from `docs/doc-sync.md`
- relevant subsystem and domain area
- context read
- existing patterns
- applicable decisions
- invariants
- blockers or prerequisites
- recommended approach
- test plan
- docs to update

Use the taxonomy classification to choose which context cards, ADRs, invariants, runbooks, and tests
must be read before coding. Use doc sync metadata to check whether those docs have watched code or
test changes since their review baseline.

## Blocker Handling

Blockers include:

- missing product decision
- ambiguous architecture decision
- unavailable required service or credential
- conflicting docs and code with no safe default
- destructive operation requiring explicit approval

When a blocker exists, recommend a default decision if possible.

## Implementation

After approval:

- make scoped changes
- follow existing patterns
- add tests near the behavior
- update relevant docs
- run verification
- summarize commits and residual risks

## Documentation Updates

Update docs when changes affect:

- architecture
- APIs
- taxonomy categories or routing rules
- doc sync baselines or watched paths
- invariants
- testing strategy
- deployment/runtime
- reusable subsystem patterns
