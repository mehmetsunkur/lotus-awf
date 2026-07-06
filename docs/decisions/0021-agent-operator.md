# ADR-0021: Agent operator — sessions as documents, operator as client

Date: 2026-07-06

## Status

Accepted

> **Amendment (2026-07-06, implementation):** outcome facts (`outcome`, `startedAt`,
> `finishedAt`) live in an operator-authored `outcome.json` artifact, not on the session
> payload — `canEditDocument` is authors-only, so the operator's only write authority
> over a requester's session is transitions. This strengthened the decision's own rule:
> the operator never mutates documents it did not author.

## Context

M26/M27 proved external coding-agent CLIs can operate the platform as business users,
steered entirely by company data (job descriptions, handbook, `@me` queues). But the
thing that RUNS those agents is a Playwright spec: prompt assembly, token minting,
driver spawning, and diagnostics collection all live in the test harness, and every run
requires a developer invoking a test suite. There is no operational way to request an
agent shift, see whether it ran, or read what it did — and no governed boundary around
WHO may cause an agent to run as WHOM.

## Taxonomy

- Subsystem: NEW operator component (`src/operator/**`), Server (bundled template)
- Domain Area: Identity & sessions, Access control, App lifecycle, Agent interface
- Risk Class: Security, Authentication, Agent interface safety
- Runtime Surface: long-running operator process; Internal API as its only backend

## Decision

1. **Sessions are documents; the lifecycle is a workflow.** A bundled `agent-ops` app
   holds `agent-session` documents (`requested → running → completed | failed`) and
   `artifact` child documents. The `requested` state is responsible
   `group:agent-operators`, so the operator's work queue is an ordinary ADR-0020 `@me`
   view, and the `claim` transition's `from: requested` guard makes double-claim a 422 —
   dedupe is a workflow guard, not new infrastructure. Audit, history, assignee
   hand-offs, and ACL all come from the substrate.
2. **The operator is a client, never a backend.** A standalone daemon
   (`src/operator/**`) authenticates as a directory identity (`person:agent-operator`,
   member of `group:agent-operators`) and does everything through the public HTTP API —
   the ADR-0011 host-as-client rule verbatim: no CouchDB access, no caller-supplied
   principals, no new authority. Driver credentials stay in the daemon's environment,
   never in documents.
3. **Prompts are derived, never supplied.** `form:agent-session` has NO prompt text
   field. The operator assembles the persona's prompt exactly as M27 does — job
   description from the org app plus the handbook pointer — and performs that
   derivation UNDER THE PERSONA'S OWN SESSION (it mints the persona's token first and
   reads the employee record through it), so the derivation can only see what the
   persona can see and the operator needs no read grants on business apps. A requester
   therefore cannot make another persona's agent execute arbitrary instructions; any
   future task-parameterization must arrive as governed company data (M27's
   task-document pattern), not as request text.
4. **Completed/failed is process outcome only.** `completed` = the driver run finished
   cleanly within budget/timeout; `failed` = spawn error, budget/timeout, crash, or
   orphaned (operator died mid-run; swept on next startup). Judging work quality is out
   of the operator's authority.

## Alternatives Considered

1. **Run agents from inside the Express server** (a tick like the M8 agent runtime).
   Rejected: spawning external CLIs drags process management, third-party credentials,
   and unbounded blocking work into the substrate, and couples API availability to
   agent execution.
2. **A separate job store (queue table, Redis, files).** Rejected: the platform IS a
   workflow/document store with ACL, audit, and `@me` routing; a parallel store would
   duplicate all of it without the governance.
3. **Free-text prompt on the session document.** Rejected outright as privilege
   escalation through the operator (requester authors text, agent executes it under
   another persona's authority).
4. **Operator reads org/kb under its own elevated identity.** Rejected: requires
   granting the operator read into business apps (and org form `defaultReaders`
   changes); deriving under the persona's own session needs zero extra grants and is
   least-privilege by construction.

## Consequences

- Positive: agent execution becomes requestable, observable, and governed with zero new
  substrate; the claim/dedupe/orphan semantics reuse workflow guards; the security
  boundary is a data-shape rule (no prompt field) that reviews can check statically.
- Negative: artifacts are operator-created documents, and with no per-document readers
  API their visibility is form-level (`defaultReaders`) — v1 scopes transcripts to
  operators + admins, so a requester cannot read their own session's transcript without
  admin help. That is an accepted limitation and a recorded substrate finding (a
  readers-widening mechanism would need its own ADR).
- Negative: a second operator instance is safe (claim guard) but wasteful; horizontal
  operation is future work.
- Negative: minting a persona's session token requires that persona's credentials —
  there is no delegated-minting authority in the substrate. V1 therefore holds a
  shared persona password in the daemon's environment
  (`LOTUS_OPERATOR_PERSONA_PASSWORD`), which is acceptable in fixture worlds and an
  explicit deployment constraint otherwise. A scoped "mint session for person X"
  grant is the recorded follow-up and needs its own ADR.

## Follow-Ups

- Scheduler that files session requests (changes who files, not the mechanism).
- Deploy packaging (sidecar) under the deployable-artifact invariant.
- Requester-visible artifacts if/when a governed readers-widening mechanism exists.
