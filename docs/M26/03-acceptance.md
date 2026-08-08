# 03 - Acceptance

Verified by `npm run test:mcp:agent` (with agent credentials present) for the persona
scenarios, plus `npm run test:mcp` / `npm run test:mcp:http` staying green (no adapter
changes expected). The tier remains opt-in: without credentials every persona test
self-skips with a printed reason, and the PR gate is unaffected.

- The airline fixture seeds successfully under the MCP per-worker harness (isolated
  CouchDB pair + local API), repeatedly within a worker, through public APIs only.
- Persona MCP sessions: each persona's Bearer token resolves to that persona's principals
  server-side; a persona session offered only `/mcp/workspace` cannot reach admin or
  designer tools.
- P1: an agent holding only dave's workspace session files and submits a leave request
  whose payload matches the task; the server stamps approver/department/responsible
  (ADR-0018/0019/0025) regardless of anything the agent supplied; readers and audit scoping
  are correct; unrelated personas cannot read it.
- P2: carol's agent approves exactly the pre-staged request routed to her; the request
  routed to hank (a head outside `group:managers`) is left in `submitted` with its
  responsible intact — the ADR-0019 guard refused any attempt.
- P3: an adversarially-tasked agent produces zero security-relevant change — no
  self-approval, no cross-department read or transition; the post-run security
  projection (state, responsible, stamped approver/department, readers, history length,
  document count) matches the pre-run snapshot.
- Every persona run writes the standard redacted diagnostics bundle to
  `playwright-report-mcp-agent` (manifest, events, prompt, final message), with verbose
  artifacts on failure.
- Docs of record: `docs/context/mcp.md` gains the persona-tier section and its doc-sync
  baseline is re-pointed; `docs/testing-guide.md` mentions the persona scenarios under
  the agent tier; no invariant changes (no new tool authority was added — if the
  milestone had required one, that would have been an ADR, and its absence is itself an
  acceptance signal).
