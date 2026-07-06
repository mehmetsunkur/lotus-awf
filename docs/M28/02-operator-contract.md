# 02 - Operator contract

## Resolved scope questions

- **Driver-code home**: promoted. `agent-driver.ts` and the diagnostics
  redactor move from `tests/mcp/agent/support/` to `src/operator/`; the test suites
  re-import from the new home. Runtime never imports from `tests/`.
- **Artifact cap**: 64 KB per artifact document; full verbose files stay on the
  daemon's disk only.
- **Requester ACL (twin world)**: `group:managers` author, `group:agent-operators`
  editor, `group:admins` manager.
- **Identity bootstrap**: test fixtures seed `person:agent-operator` +
  `group:agent-operators`; real deployments create them as documented ops steps (no
  first-run changes).
- **Cadence/spend**: 15 s poll tick; `LOTUS_OPERATOR_MAX_SESSIONS_PER_DAY` hard cap.

## `agent-ops` template

- `form:agent-session` — exactly two fields: `persona` (directory id, `person:*`
  validation) and `driver` (select: `claude-code` | `codex`). NO prompt field — by
  ADR-0021 there is nothing to validate away; the field does not exist. And NO
  operator-stamped payload fields either: `canEditDocument` is authors-only, so the
  operator (which does not author the requester's session) can never PUT its payload —
  the operator's only write authority over a session is TRANSITIONS. Outcome facts
  (`outcome`, `startedAt`, `finishedAt`, persona, driver) live in an operator-authored
  `outcome.json` artifact instead; state/assignee/history/audit on the session are
  engine-stamped. `defaultReaders: [group:agent-operators, group:admins]` (the
  requester reads their own session via creator principals).
- `form:artifact` — `sessionId`, `name` (e.g. `prompt.txt`, `final_message.txt`,
  `events.jsonl`, `tool-transcript.jsonl`), `content` (textarea, capped).
  `defaultReaders: [group:admins]` — operator-created, so effective readers are
  operator principals + admins. Requester-visible transcripts are the ADR-0021
  accepted limitation.
- `workflow:agent-session` — `draft` (initial) → `submit` → `requested` (responsible
  `group:agent-operators` → the operator's `@me` queue) → `claim` → `running`
  (responsible `group:agent-operators`) → `complete` → `completed` (final) or
  `fail` → `failed` (final). `draft` exists for the same substrate reason as M27's
  `planned` state: `assignee` is stamped only by `applyTransition`, so a session born
  directly into `requested` would never appear in the operator's `@me` queue —
  requesters create a draft and `submit` it (guard: persona + driver present).
  `claim`/`complete`/`fail` guard on `principals.includes('group:agent-operators')`;
  all transitions carry `audit-transition`. The `claim` guard's `from: requested` is
  the dedupe: a racing second claim gets 422.
- Views: `view:my-sessions` (`assignee in @me`, non-final — the operator queue),
  `view:sessions` (all, by state), `view:artifacts` (all artifacts; column
  `payload.sessionId` — per-session filtering is a query, not a bespoke view).

## Daemon (`src/operator/**`, `npm run agent-operator`)

Single-process tick loop, injectable drivers (`runOperator(config, drivers)` — the
entry point wires the real `ClaudeCodeDriver`/`CodexDriver`; tests inject a fake).

Per tick:

1. `GET view:my-sessions` as the operator identity (login/re-login via the shared
   lotus HTTP client; ADR-0011 client rules).
2. For the oldest session: `claim` (transition). A 422 means another instance won —
   skip. Refuse new claims once `LOTUS_OPERATOR_MAX_SESSIONS_PER_DAY` is reached.
3. **Derive the prompt under the persona's own session**: mint the persona's
   `lotus_session` token (the personaBearer mechanism), and with it read the
   directory (displayName) and the persona's own employee document in the org app
   (jobTitle, jobDescription). Assemble the prompt with the same shared pure function
   `twin.spec.ts` uses (`assembleShiftPrompt` — extracted so spec and daemon stay
   byte-identical). The operator itself needs zero read grants on org/kb.
4. Spawn the driver with ONLY `lotus-workspace` (persona Bearer) as in M26/M27;
   diagnostics land in a per-session directory on the daemon's disk.
5. On completion: redact + cap each diagnostics file to 64 KB and `POST` it as an
   `artifact` document (`sessionId` = the session's `_id`); write the outcome facts as
   an operator-authored `outcome.json` artifact (NEVER a session-payload write —
   `canEditDocument` is authors-only; see the form section above and the ADR-0021
   amendment); transition `complete` (run finished cleanly) or `fail` (with the
   artifact's `outcome` naming the reason). A failing run never crashes the tick.

Startup sweep: any session already in `running` belongs to a dead operator
(single-operator deployment) — `fail` it with `outcome: orphaned` before entering the
loop. SIGTERM: finish or fail the in-flight session, then exit.

## Environment contract

- `LOTUS_OPERATOR_API_URL` (required), `LOTUS_OPERATOR_USERNAME` / `_PASSWORD`
  (the operator directory identity), `LOTUS_OPERATOR_MCP_WORKSPACE_URL` (the MCP HTTP
  host's workspace surface, handed to drivers).
- `LOTUS_OPERATOR_PERSONA_PASSWORD` — minting a persona's session token requires that
  persona's credentials; the substrate has no delegated-minting authority, so v1 takes
  a single shared persona password (the fixture world's model). This is an ADR-0021
  recorded limitation; a "mint scoped session for person X" grant is follow-up work
  that needs its own ADR.
- `LOTUS_OPERATOR_COMPANY_NAME` — the identity line's company name (prompt input;
  fixture worlds pass "Agentic Airlines PLC").
- `LOTUS_OPERATOR_APP_ID` (default `agent-ops`), `_ORG_APP_ID` (default `org`),
  `_KB_APP_ID` (default `kb`) — operator config, never request data.
- `LOTUS_OPERATOR_POLL_MS` (default 15000), `LOTUS_OPERATOR_MAX_SESSIONS_PER_DAY`
  (default 20).
- Driver env unchanged: `LOTUS_AGENT_<DRIVER>_*` — credentials live here only.

## Tests

- **FakeDriver integration** (`tests/e2e/agent-operator.spec.ts`, PR-gate eligible —
  deterministic, no credentials): seeds the twin fixture + agent-ops app + operator
  identity, runs operator ticks in-process with an injected fake driver, and proves:
  claim (assignee/history stamped), artifact documents created with capped/redacted
  content and correct readers, `completed` and `failed` paths, double-claim 422
  (scripted second claim), orphan sweep (a pre-staged `running` session fails with
  `orphaned` on startup), and the derived prompt exactly equals
  `assembleShiftPrompt`'s output for the persona (prompt-hygiene by construction).
- **Real-driver operator session** (`tests/mcp/agent/operator.spec.ts`, opt-in /
  nightly, self-skips without credentials): harness + in-process MCP host + daemon
  with real drivers; one carol session filed as a manager, asserting the session
  reaches `completed` with artifacts and carol's M27-style queue outcomes hold.

## Cost & flake controls

The FakeDriver tier is free and deterministic. The real-driver tier adds ONE agent run
per pass, same budget regime as M26/M27. The daemon's own spend guard
(`MAX_SESSIONS_PER_DAY`) is enforced in code, not convention, so a request flood
cannot burn unbounded driver spend even outside tests.
