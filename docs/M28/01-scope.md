# 01 - Scope

## In scope

- **A sixth bundled template, `agent-ops`**: `form:agent-session` (persona and driver
  only — outcome facts moved to an operator-authored `outcome.json` artifact at
  implementation, since `canEditDocument` is authors-only; see the ADR-0021 amendment
  and `02-operator-contract.md`), `form:artifact` (sessionId, name, capped text content),
  `workflow:agent-session` (`requested → running → completed | failed`; `requested` is
  responsible `group:agent-operators` so sessions land in the operator's ADR-0020 `@me`
  queue; the `claim` transition `requested → running` is guard-gated on
  `group:agent-operators` — a second claim on an already-running session is refused by
  `from`-state, which IS the dedupe), views (`view:my-sessions` for the operator queue,
  `view:sessions` by state, `view:artifacts` filterable by session). Sessions and
  artifacts render in the standard runtime — no custom client work.
- **Operator identity**: `person:agent-operator` in the directory plus
  `group:agent-operators`; the daemon logs in like any user (session cookie/token,
  re-login on 401 via the existing lotus HTTP client). Never a CouchDB connection, never
  a caller-supplied principal — the MCP-host architecture rule verbatim (ADR-0011).
- **The daemon** (`src/operator/**`, entry `npm run agent-operator`): a tick loop that
  polls its `@me` queue over the public API, claims a session (transition), assembles
  the **derived prompt** — persona job description from the org app + kb pointer,
  the exact M27 mechanism, extracted into a module shared with `twin.spec.ts` — mints
  the persona's workspace Bearer, spawns the driver CLI, and on completion writes
  redacted+capped artifact documents and transitions the session to `completed`
  (run finished cleanly) or `failed` (spawn error, budget/timeout, crash), with the
  reason on the session. Outcome means PROCESS outcome, never work quality.
- **Durability semantics** (rhyming with the M8 agent-runtime invariant, though this is
  a separate component): on startup the daemon sweeps sessions left in `running` by a
  dead operator to `failed` with reason `orphaned`; a failing run never crashes the
  tick; SIGTERM finishes or fails the in-flight session before exit. Single-operator
  deployment; the claim guard is the safety if two ever run.
- **Driver/diagnostics promotion**: `AgentDriver` (claude-code/codex spawn + budget +
  redaction) moves from `tests/mcp/agent/support/` into `src/operator/` so runtime code
  never imports from `tests/`; the test suites re-import from the new home unchanged.
  Driver credentials stay env-side (`LOTUS_AGENT_<DRIVER>_*`), never in documents.
- **Security boundaries** (ADR material): prompts are derived only — `form:agent-session`
  carries no prompt text field at all; app ACL governs who may create/request sessions;
  artifact readers are deliberate (operator, requester, admins — a transcript reveals
  everything the persona could see); every artifact passes the existing diagnostics
  redactor before becoming a document.
- **ADR-0021**: operator-as-client, session-as-document lifecycle, derived-prompt rule,
  claim-guard dedupe, and the completed/failed = process-outcome semantics.
- **Tests**: a FakeDriver integration spec (deterministic, no credentials, PR-gate
  eligible) proving the full lifecycle against the per-worker harness — claim, artifact
  mapping, completed and failed paths, double-claim 422, orphan sweep on restart; plus
  one opt-in real-driver operator session (nightly tier, self-skipping) proving the
  daemon can run a genuine M27-style shift end to end.
- **Docs of record**: context cards (server: template + new component; mcp: driver-code
  move), testing guide, and the M28 docs themselves.

## Out of scope

- **Scheduling.** No cron, no rosters: v1's trigger is a session document created in
  `requested` (auditable, workflow-native). A scheduler that files "morning shift"
  requests is a later increment that changes who files, not the mechanism.
- **Free-text or task-parameterized prompts.** Any "run this instruction as persona X"
  capability is privilege escalation through the operator and is explicitly rejected,
  not deferred — a future task mechanism would have to arrive as governed company data
  (M27's task-document pattern), never as prompt text on the request.
- **Multi-operator scale-out** (leader election, work sharing). The claim guard makes a
  second operator safe but idle-ish; true horizontal operation is future work.
- **Quality/review states.** No `reviewed`/`approved` beyond `completed|failed`; judging
  the work belongs to humans or a later reviewer tier, not the operator.
- **Deploy packaging** (compose/k8s sidecar, image changes). V1 runs as a local
  long-running process like `explore:twin`; packaging is its own increment with the
  deployable-artifact invariant in play.
- **M8 platform agent runtime changes.** The Notes-style scheduled-agent substrate
  (`agent:*`/`agentrun:*` runtime docs) is untouched; naming deliberately avoids its
  prefixes (`agent-ops` app, `agent-session`/`artifact` docTypes).
- **MCP surface changes.** The operator consumes the HTTP API directly (reusing the
  lotus HTTP client); no new tools, no tool-authority change.
- **Custom UI** for sessions/artifacts beyond the metadata-driven runtime.

## Taxonomy

- Subsystem: NEW operator component (`src/operator/**` — runtime code, first-class like
  `src/mcp`), Server (template registry entry, `templates/agent-ops/*`), e2e/test
  support. Client untouched.
- Domain Area: Identity & sessions, app lifecycle, access control, definitions-as-data,
  query & indexing (`@me` consumed by the daemon itself).
- Change Type: Feature + Architecture change (new runtime component + ADR-0021).
- Risk Class: Security (ACL, prompt-injection boundary), Authentication (service
  identity), Agent interface safety (driver spawning, credential handling).
- Runtime Surface: new long-running process (CLI-launched daemon), Internal API as its
  only backend surface.
- Ownership Boundary: project-owned throughout.
- Relevant ADRs: 0011 (host-as-client precedent), 0016 (appId-agnostic templates), 0018
  (assignee), 0019 (guard-gated authority), 0020 (`@me` queues); new ADR-0021;
  M27/02-twin-contract (derived-prompt mechanism).

## Open questions for review

1. **Driver-code home**: promote `agent-driver.ts` + the diagnostics redactor to
   `src/operator/` (lean — runtime must not import from `tests/`), or duplicate a
   slimmed runtime copy and leave the test bed untouched?
2. **Artifact cap**: per-artifact payload cap, lean 64 KB with the full verbose file
   kept on the daemon's disk only (documents replicate to every reader's local replica).
3. **Requester ACL in the twin world**: who gets author on `agent-ops` — lean
   `group:managers` (managers request shifts), operators editor, admins manager.
4. **Operator identity bootstrap**: seeded by the twin fixture for tests (lean), with
   real-deployment creation documented as ops steps — or a first-run/setup extension
   (heavier, touches app lifecycle)?
5. **Tick cadence + spend guard defaults**: lean 15 s poll, `LOTUS_OPERATOR_MAX_SESSIONS_PER_DAY`
   hard cap (daemon refuses beyond it) so a request flood cannot burn unbounded driver spend.
