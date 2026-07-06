# M28 — Agent operator: sessions as documents, lifecycle as workflow

M27 proved the substrate can *steer* an agent from company data alone. M28 makes the
platform *operate* them: a standalone **agent-operator daemon** — an authenticated API
client in the mold of the MCP-over-HTTP host, never part of the API server — reads its
work from a new **`agent-ops`** app and runs persona shifts on demand.

The control plane is the platform itself:

- an **`agent-session` document** is the unit of work: who (persona), how (driver),
  requested by whom;
- its **workflow** is the lifecycle: `requested → running → completed | failed` — and
  the `requested` state's responsibility routes sessions into the operator's own `@me`
  queue, so the daemon discovers work exactly the way carol does. The claim transition's
  `from: requested` guard makes double-claim a 422: dedupe is a workflow guard, not new
  infrastructure;
- **artifact documents** (capped, redacted diagnostics: prompt, final message, events,
  tool transcript) hang off each session, ACL-scoped like everything else.

Prompts are **derived, never supplied**: a session names a persona, and the operator
assembles the same job-description + handbook-pointer prompt the M27 working day uses.
A requester cannot make another persona's agent do arbitrary things by writing prompt
text into a document — that rule is the milestone's security core and gets an ADR.

- `01-scope.md` — in/out of scope and taxonomy.
- `02-operator-contract.md` — template, daemon loop, claim/sweep semantics, artifact
  mapping, env contract *(after scope review)*.
- `03-acceptance.md` — acceptance criteria *(after scope review)*.
