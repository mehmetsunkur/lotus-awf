# 03 - Acceptance

Verified by `npm run test:unit` (registry), `npm run test:e2e` (FakeDriver operator
lifecycle — on the PR gate), and `npm run test:mcp:agent` (one real-driver operator
session, opt-in / nightly, self-skipping). `npm run test:mcp` / `test:mcp:http` stay
green (driver-code move only; no MCP surface change).

- **Template**: `agent-ops` deploys from the bundled registry under arbitrary appIds
  (ADR-0016); `form:agent-session` has no prompt field (statically checkable —
  ADR-0021); the `claim` transition refuses a second claim with 422 by `from`-state.
- **Operator identity**: the daemon authenticates as `person:agent-operator` through
  the public API only; no CouchDB access anywhere under `src/operator/**`; driver
  credentials appear only in daemon env, never in any document (artifact content is
  redacted before write).
- **Queue mechanics**: a `requested` session appears in the operator's
  `view:my-sessions` via ADR-0020 `@me`; claiming stamps assignee/history (ADR-0018);
  all transitions carry `audit-transition` records.
- **Derived prompt**: byte-identical to `assembleShiftPrompt(...)` output for the
  persona (the same function `twin.spec.ts` uses), and the derivation runs under the
  persona's own session — the operator identity holds no read grants on org/kb, and
  the FakeDriver spec asserts the prompt it received.
- **Artifacts**: one `artifact` document per diagnostics file, content capped at
  64 KB and redacted, `sessionId` linked, readable by operators + admins (the
  requester-visibility limitation is recorded in ADR-0021, not silently absent).
- **Outcomes**: `completed` only on a clean driver run; `failed` carries a reason
  (`driver-error`, `budget`, `orphaned`, ...); a pre-staged orphaned `running` session
  is swept to `failed(orphaned)` on daemon startup; a failing run never kills the
  tick loop; the daily session cap refuses further claims in code.
- **Real-driver session (nightly)**: a manager-filed carol session reaches
  `completed` end to end — daemon claim, real driver over the persona's workspace
  session, artifacts written — and carol's queue outcomes match the M27 contract.
- **Test-bed continuity**: `agent.spec.ts`, `personas.spec.ts`, and `twin.spec.ts`
  pass unchanged apart from imports (driver/diagnostics promoted to
  `src/operator/`); prompt assembly in `twin.spec.ts` goes through the shared
  `assembleShiftPrompt`.
- **Docs of record**: ADR-0021 accepted; `docs/context/server.md` (template, new
  component entry) and `docs/context/mcp.md` (driver-code home) reconciled and
  re-baselined; `docs/testing-guide.md` gains the operator tiers; M28 docs amended if
  implementation forces deviations.
