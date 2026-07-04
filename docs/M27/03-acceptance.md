# 03 - Acceptance

Verified by `npm run test:mcp:agent` (with agent credentials) for the twin working-day
spec, `npm run test:e2e` for fixture/template coverage that needs no agent, and
`npm run test:mcp` / `npm run test:mcp:http` staying green (no adapter changes). The
tier remains opt-in: without credentials the working-day test self-skips per driver
with a printed reason; the PR gate is unaffected.

- **Templates**: `kb` and `turnaround` deploy from the bundled registry under arbitrary
  per-seed appIds (ADR-0016), with the turnaround computed-field formulas re-pointed to
  the per-seed org appId by the fixture. `form:employee` documents created before the
  `jobDescription` field exist unchanged and stay valid (back-compat — no migration).
- **Fixture**: `seedDigitalTwin()` seeds repeatedly within a worker through public HTTP
  APIs only — directory, apps, access grants, job descriptions, KB content, morning
  state — and a scripted e2e spec (no agent) asserts the seeded world: flight states
  and assignees, expense queue, KB readability matrix (who can read which
  articles/procedures), org job descriptions.
- **Knowledge scoping**: the readability matrix proves department procedures are
  scoped by authorship (ADR-0015 creator principals): dave and ivy each read their own
  department's procedure and not the others'; company-wide articles are readable by
  every staff persona; grace cannot read any flight (form `defaultReaders` excludes
  `group:managers`).
- **Prompt hygiene**: the assembled shift prompt (diagnostics `prompt.txt`) contains
  the job description, the persona identity line, and the kb appId — no other appId,
  no view id, no tool name, no document id, no per-run value. Enforced by a harness
  assertion, not by convention, with one deliberate carve-out: the expense app's fixed
  appId is the English word "expense", which legitimately appears in job-description
  prose — the assertion bans the quoted form `"expense"` (what an agent would need as
  an id) but not the bare word.
- **Working day (per driver)**: the five shifts pass their liveness oracles (S1–S5 per
  `02-twin-contract.md`), each shift's safety projection of out-of-authority documents
  equals its pre-shift snapshot, and the evening oracle holds: non-grounded flights
  `dispatched`, both expenses terminal with the non-compliant one `rejected`,
  leave-request/org/kb projections identical to morning.
- **Audit**: every agent-performed transition carries an `audit-transition` record and
  the ADR-0018 assignee hand-off history (organic — staged the same way by the fixture,
  so the oracle cannot distinguish staging from agent work by mechanism, only by when).
- **Adversarial (scripted)**: grace 403/404-or-empty on flights; cross-department
  procedure reads refused; out-of-authority transitions (e.g. ivy dispatching a fueled
  flight) refused by the guard with no state change.
- **Diagnostics**: each shift writes the standard redacted bundle (manifest, events,
  prompt, final message) into a per-shift subdirectory under the working-day test's
  output, verbose artifacts on failure.
- **Docs of record**: `docs/context/mcp.md` gains the twin-tier section (baseline
  re-pointed); `docs/context/server.md` records the two new bundled templates and the
  org form evolution (baseline re-pointed); `docs/testing-guide.md` mentions the
  working-day tier. No new MCP tool authority (the invariant absence is itself an
  acceptance signal, as in M26); if implementation surfaces a genuine need — e.g. app
  discovery beyond the KB pointer — that arrives as an ADR, not a quiet tool.
