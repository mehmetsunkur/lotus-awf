# 01 - Scope

## In scope

- **Org template evolution**: a `jobDescription` field on `form:employee`
  (definitions-as-data, evolved in place the way ADR-0019 evolved leave-request).
  Job descriptions are written at handbook altitude — responsibilities and ownership
  ("you approve your department's leave and sign off completed ground checks"), never
  tool names, view ids, or per-run values. The persona's job description IS the agent's
  prompt; there is no other task text.
- **A fourth bundled template, `kb`** (company handbook): company-wide articles plus
  department-scoped procedures, so `readers` personalizes each persona's effective
  knowledge. Scoping uses the mechanism the substrate actually has (ADR-0015): per-form
  `defaultReaders` for company-wide articles, and *authorship* for procedures — seeded
  by a member of the owning department, whose principal set becomes the readers (there
  is deliberately no per-document readers API; see `02-twin-contract.md`).
  Articles name the other apps by their (per-seed) appIds and describe processes the way
  an ops manual would. This resolves app discovery with data instead of a new MCP tool:
  the only prompt-visible artifact besides the job description is one bootstrap line
  naming the KB appId — the wiki-URL a new hire gets on day one.
- **A fifth bundled template, `turnaround`** (operations): one flight document flowing
  through a 3–4 hop workflow whose states are owned by different departments (crew
  assignment → ramp/ground checks → dispatch sign-off, exact states settled in
  `02-twin-contract.md`), with per-state responsibility (ADR-0018), guard-gated stamped
  responsibles (ADR-0019), and actor-aware `@me` views (ADR-0020). This is the twin's
  actual work surface: job descriptions drive *reactive* queue work, and a chained
  workflow generates its own triggers — each completed hop lands the document in the
  next department's inbox. Multi-hop, cross-department routing is also a strictly
  stronger substrate test than leave-request's single requester→approver hop.
- **Fixture**: `seedDigitalTwin()` composing on top of `seedAgenticAirlines()` — deploys
  kb + turnaround under per-seed appIds (ADR-0016), writes job descriptions and KB
  articles (embedding the per-seed appIds known at seed time), and stages a **morning
  state**: flights parked at various workflow stages plus submitted expenses awaiting
  finance, all through public HTTP APIs only.
- **Shift protocol + spec** (`tests/mcp/agent/twin.spec.ts`, same opt-in
  `playwright.mcp.agent.config.ts`, same driver matrix): personas run **sequentially**,
  one workspace-only MCP session each (M26 persona-session contract unchanged); prompt =
  job description fetched from the org app + fixed bootstrap line. Cross-persona flow
  emerges from shared server state between shifts, not from agent-to-agent interaction.
- **Oracles** (scripted API reads, never the transcript): *liveness* — every document
  staged into a persona's queue reached an expected terminal state (approve and reject
  both pass; the assertion is "the assigned work got worked"); *safety* — the security
  projection (state, responsible set, stamped payload fields, readers, history length, doc count)
  of everything outside the persona's authority matches the pre-shift snapshot
  (`state-snapshot.ts` mechanism generalized from M26 P3). One adversarial probe:
  a persona cannot read another department's KB procedures or turnaround steps.

## Out of scope

- **Concurrent agents.** Shifts are sequential single-agent runs; simultaneous actors
  (races on shared documents, parallel driver runs, N× budget) are a later milestone.
- **New MCP tools or authority** — including `lotus_workspace_list_apps`. The KB
  bootstrap pointer makes it unnecessary; if a shift proves impossible without a new
  tool, that is a finding to surface (M26 rule), not a change to make inside M27.
- **Injecting KB content into prompts.** The prompt carries a pointer, never article
  text: harness-side knowledge assembly would bypass `readers` at read time, pay tokens
  unconditionally, and collapse the tier back into hand-assembled prompts.
- **Leave-request as twin work.** Filing leave is personally-motivated, not
  job-description work (the initiating side of that flow never fit; the approving side
  is subsumed by turnaround + expense queues). Leave-request stays in the world as
  background/adversarial ACL surface, and M25/M26 suites continue to cover it unchanged.
- **Self-bootstrap identity** ("read your own employee record to learn your role") —
  the harness fetches the job description and hands it over; a discovery step before
  the behavior under test adds a failure mode without adding evidence.
- **Exact-match oracles on open-ended behavior.** M26 pins prompt values; M27 runs are
  open-ended by design, so oracles are invariant-style (terminal states + snapshot),
  never byte-equality on agent-authored payloads.
- **The platform's own agent runtime**, server runtime changes beyond the three template
  deliverables, PR-gate inclusion (stays opt-in / nightly), and browser UI coverage.

## Taxonomy

- Subsystem: Server (template registry: `kb` + `turnaround`, org template field —
  `templates/**`), MCP Adapter (tests only), e2e/test support. Unlike M26 this is not a
  zero-`src/**` tier: the bundled templates and registry entries are the deliberate
  substrate additions; runtime code is otherwise untouched.
- Domain Area: App lifecycle, definitions-as-data, access control, identity & sessions,
  query & indexing (ADR-0020 `@me` consumed across chained hops).
- Change Type: Feature (additive templates + test tier).
- Risk Class: Security (ACL/readers — KB scoping), agent interface safety, contract /
  back-compat (org `form:employee` evolves in place for existing deployments).
- Runtime Surface: MCP HTTP (`/mcp/workspace`) for agents; Internal API for seeding and
  oracles.
- Ownership Boundary: project-owned throughout.
- Relevant ADRs: 0011 (MCP over HTTP), 0016 (appId-agnostic templates), 0018 (assignee),
  0019 (stamped responsibles + guard), 0020 (`@me` filters); M24/02-tool-contract,
  M26/02-agent-contract (persona sessions, cost controls).

## Open questions

*Resolved at scope review — decisions recorded at the top of `02-twin-contract.md`:*
4-hop workflow; single KB app (authorship-scoped procedures); minimal shift roster
(carol ×2, ivy, hank, grace); template named `turnaround`.
